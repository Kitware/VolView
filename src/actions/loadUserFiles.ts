import { UrlParams } from '@vueuse/core';
import {
  fileToDataSource,
  uriToDataSource,
  DataSource,
  getDataSourceName,
} from '@/src/io/import/dataSource';
import useLoadDataStore from '@/src/store/load-data';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { wrapInArray, nonNullable, partition } from '@/src/utils';
import { basename } from '@/src/utils/path';
import { parseUrl } from '@/src/utils/url';
import { logError } from '@/src/utils/loggers';
import {
  importDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import {
  ErrorResult,
  ImportResult,
  LoadableResult,
  LoadableVolumeResult,
  isLoadableResult,
  isVolumeResult,
  ImportDataSourcesResult,
} from '@/src/io/import/common';
import { isDicomImage } from '@/src/utils/dataSelection';
import { useViewStore } from '@/src/store/views';

// higher value priority is preferred for picking a primary selection
const BASE_MODALITY_TYPES = {
  CT: { priority: 3 },
  MR: { priority: 3 },
  US: { priority: 2 },
  DX: { priority: 1 },
} as const;

function findBaseDicom(loadableDataSources: Array<LoadableResult>) {
  // find dicom dataset for primary selection if available
  const dicoms = loadableDataSources.filter(({ dataID }) =>
    isDicomImage(dataID)
  );
  // prefer some modalities as base
  const dicomStore = useDICOMStore();
  const baseDicomVolumes = dicoms
    .map((dicomSource) => {
      const volumeInfo = dicomStore.volumeInfo[dicomSource.dataID];
      const modality = volumeInfo?.Modality as keyof typeof BASE_MODALITY_TYPES;
      if (modality in BASE_MODALITY_TYPES)
        return {
          dicomSource,
          priority: BASE_MODALITY_TYPES[modality]?.priority,
          volumeInfo,
        };
      return undefined;
    })
    .filter(nonNullable)
    .sort(
      (
        { priority: a, volumeInfo: infoA },
        { priority: b, volumeInfo: infoB }
      ) => {
        const priorityDiff = a - b;
        if (priorityDiff !== 0) return priorityDiff;
        // same modality, then more slices preferred
        if (!infoA.NumberOfSlices) return 1;
        if (!infoB.NumberOfSlices) return -1;
        return infoB.NumberOfSlices - infoA.NumberOfSlices;
      }
    );
  if (baseDicomVolumes.length) return baseDicomVolumes[0].dicomSource;
  return undefined;
}

function isSegmentation(extension: string, name: string) {
  if (!extension) return false; // avoid 'foo..bar' if extension is ''
  const extensions = name.split('.').slice(1);
  return extensions.includes(extension);
}

function sortByDataSourceName(a: LoadableResult, b: LoadableResult) {
  const nameA = getDataSourceName(a.dataSource) ?? '';
  const nameB = getDataSourceName(b.dataSource) ?? '';
  return nameA.localeCompare(nameB);
}

// does not pick segmentation or layer images
function findBaseImage(
  loadableDataSources: Array<LoadableResult>,
  segmentGroupExtension: string,
  layerExtension: string
) {
  const baseImages = loadableDataSources
    .filter(({ dataType }) => dataType === 'image')
    .filter((importResult) => {
      const name = getDataSourceName(importResult.dataSource);
      if (!name) return false;
      return (
        !isSegmentation(segmentGroupExtension, name) &&
        !isSegmentation(layerExtension, name)
      );
    });

  if (baseImages.length) return baseImages[0];
  return undefined;
}

// returns image and dicom sources, no config files
function filterLoadableDataSources(succeeded: Array<ImportResult>) {
  return succeeded.filter(isLoadableResult);
}

// Returns list of dataSources with file names where the name has the extension argument
// and the start of the file name matches the primary file name.
function filterMatchingNames(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  extension: string
) {
  const dicomStore = useDICOMStore();
  const primaryName = isDicomImage(primaryDataSource.dataID)
    ? dicomStore.volumeInfo[primaryDataSource.dataID].SeriesNumber
    : getDataSourceName(primaryDataSource.dataSource);
  if (!primaryName) return [];
  const primaryNamePrefix = primaryName.split('.').slice(0, 1).join();
  return filterLoadableDataSources(succeeded)
    .filter((ds) => ds !== primaryDataSource)
    .map((importResult) => ({
      importResult,
      name: getDataSourceName(importResult.dataSource),
    }))
    .filter(({ name }) => {
      if (!name) return false;
      const hasExtension = isSegmentation(extension, name);
      const nameMatchesPrimary = name.startsWith(primaryNamePrefix);
      return hasExtension && nameMatchesPrimary;
    })
    .map(({ importResult }) => importResult);
}

function getStudyUID(volumeID: string) {
  const dicomStore = useDICOMStore();
  const studyKey = dicomStore.volumeStudy[volumeID];
  return dicomStore.studyInfo[studyKey]?.StudyInstanceUID;
}

function findBaseDataSource(
  succeeded: Array<ImportResult>,
  segmentGroupExtension: string,
  layerExtension: string
) {
  const loadableDataSources = filterLoadableDataSources(succeeded);
  const baseDicom = findBaseDicom(loadableDataSources);
  if (baseDicom) return baseDicom;

  const baseImage = findBaseImage(
    loadableDataSources,
    segmentGroupExtension,
    layerExtension
  );
  if (baseImage) return baseImage;
  return loadableDataSources[0];
}

function filterOtherVolumesInStudy(
  volumeID: string,
  succeeded: Array<ImportResult>
) {
  const targetStudyUID = getStudyUID(volumeID);
  const dicomDataSources = filterLoadableDataSources(succeeded).filter(
    ({ dataID }) => isDicomImage(dataID)
  );
  return dicomDataSources.filter((ds) => {
    const sourceStudyUID = getStudyUID(ds.dataID);
    return sourceStudyUID === targetStudyUID && ds.dataID !== volumeID;
  }) as Array<LoadableVolumeResult>;
}

// Layers a DICOM PET on a CT if found
function autoLayerDicoms(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>
) {
  if (!isDicomImage(primaryDataSource.dataID)) return;
  const otherVolumesInStudy = filterOtherVolumesInStudy(
    primaryDataSource.dataID,
    succeeded
  );
  const dicomStore = useDICOMStore();
  const primaryModality =
    dicomStore.volumeInfo[primaryDataSource.dataID].Modality;
  if (primaryModality !== 'CT') return;
  // Look for one PET volume to layer with CT.  Only one as there are often multiple "White Balance" corrected PET volumes.
  const toLayer = otherVolumesInStudy.find((ds) => {
    const otherModality = dicomStore.volumeInfo[ds.dataID].Modality;
    return otherModality === 'PT';
  });
  if (!toLayer) return;

  const primarySelection = toDataSelection(primaryDataSource);
  const layersStore = useLayersStore();
  const layerSelection = toDataSelection(toLayer);
  layersStore.addLayer(primarySelection, layerSelection);
}

function autoLayerByName(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  layerExtension: string
) {
  if (isDicomImage(primaryDataSource.dataID)) return;
  const matchingLayers = filterMatchingNames(
    primaryDataSource,
    succeeded,
    layerExtension
  )
    .filter(isVolumeResult)
    .sort(sortByDataSourceName);

  const primarySelection = toDataSelection(primaryDataSource);
  const layersStore = useLayersStore();
  matchingLayers.forEach((ds) => {
    const layerSelection = toDataSelection(ds);
    layersStore.addLayer(primarySelection, layerSelection);
  });
}

// Loads other DataSources as Segment Groups:
// - DICOM SEG modalities with matching StudyUIDs.
// - DataSources that have a name like foo.segmentation.bar and the primary DataSource is named foo.baz
function loadSegmentations(
  primaryDataSource: LoadableVolumeResult,
  succeeded: Array<ImportResult>,
  segmentGroupExtension: string
) {
  const matchingNames = filterMatchingNames(
    primaryDataSource,
    succeeded,
    segmentGroupExtension
  )
    .filter(
      isVolumeResult // filter out models
    )
    .sort(sortByDataSourceName);

  const dicomStore = useDICOMStore();
  const otherSegVolumesInStudy = filterOtherVolumesInStudy(
    primaryDataSource.dataID,
    succeeded
  ).filter((ds) => {
    const modality = dicomStore.volumeInfo[ds.dataID].Modality;
    if (!modality) return false;
    return modality.trim() === 'SEG';
  });

  const segmentGroupStore = useSegmentGroupStore();
  [...otherSegVolumesInStudy, ...matchingNames].forEach((ds) => {
    const loadable = toDataSelection(ds);
    segmentGroupStore.convertImageToLabelmap(
      loadable,
      toDataSelection(primaryDataSource)
    );
  });
}

function loadDataSources(sources: DataSource[]) {
  const loadDataStore = useLoadDataStore();
  const viewStore = useViewStore();

  const load = async () => {
    let results: ImportDataSourcesResult[];
    try {
      results = (await importDataSources(sources)).filter((result) =>
        // only look at data and error results
        ['data', 'error'].includes(result.type)
      );
    } catch (error) {
      loadDataStore.setError(error as Error);
      return;
    }

    const [succeeded, errored] = partition(
      (result) => result.type !== 'error',
      results
    );

    const shouldShowData = viewStore
      .getAllViews()
      .every((view) => !view.dataID);

    if (succeeded.length && shouldShowData) {
      const primaryDataSource = findBaseDataSource(
        succeeded,
        loadDataStore.segmentGroupExtension,
        loadDataStore.layerExtension
      );

      if (isVolumeResult(primaryDataSource)) {
        const selection = toDataSelection(primaryDataSource);
        viewStore.setDataForAllViews(selection);
        autoLayerDicoms(primaryDataSource, succeeded);
        autoLayerByName(
          primaryDataSource,
          succeeded,
          loadDataStore.layerExtension
        );
        loadSegmentations(
          primaryDataSource,
          succeeded,
          loadDataStore.segmentGroupExtension
        );
      } // else must be primaryDataSource.type === 'model', which are not dealt with here yet
    }

    if (errored.length) {
      const errorMessages = (errored as ErrorResult[]).map((errResult) => {
        const { dataSource, error } = errResult;
        const name = getDataSourceName(dataSource);
        logError(error);
        return error.message ? `- ${name}: ${error.message}` : `- ${name}`;
      });
      const failedError = new Error(
        `These files failed to load:\n${errorMessages.join('\n')}`
      );

      loadDataStore.setError(failedError);
    }
  };

  const wrapWithLoading = <T extends (...args: any[]) => void>(fn: T) => {
    const { startLoading, stopLoading } = useLoadDataStore();
    return async function wrapper(...args: any[]) {
      try {
        startLoading();
        await fn(...args);
      } finally {
        stopLoading();
      }
    };
  };

  return wrapWithLoading(load)();
}

export function openFileDialog() {
  return new Promise<File[]>((resolve) => {
    const fileEl = document.createElement('input');
    fileEl.setAttribute('type', 'file');
    fileEl.setAttribute('multiple', 'multiple');
    fileEl.setAttribute('accept', '*');
    fileEl.addEventListener('change', () => {
      const files = [...(fileEl.files ?? [])];
      resolve(files);
    });
    fileEl.click();
  });
}

export async function loadFiles(files: File[]) {
  const dataSources = files.map(fileToDataSource);
  return loadDataSources(dataSources);
}

export async function loadUserPromptedFiles() {
  const files = await openFileDialog();
  return loadFiles(files);
}

function urlsToDataSources(urls: string[], names: string[] = []): DataSource[] {
  return urls.map((url, idx) => {
    const defaultName =
      basename(parseUrl(url, window.location.href).pathname) || url;
    return uriToDataSource(url, names[idx] || defaultName);
  });
}

export async function loadUrls(params: UrlParams) {
  if (params.config) {
    const configUrls = wrapInArray(params.config);
    const configSources = urlsToDataSources(configUrls);
    await loadDataSources(configSources);
  }

  if (params.urls) {
    const urls = wrapInArray(params.urls);
    const names = wrapInArray(params.names ?? []);
    const sources = urlsToDataSources(urls, names);
    await loadDataSources(sources);
  }
}
