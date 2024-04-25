import { PipelineResultSuccess, partitionResults } from '@/src/core/pipeline';
import { DataSource, getDataSourceName } from '@/src/io/import/dataSource';
import {
  ImportDataSourcesResult,
  importDataSources,
  toDataSelection,
} from '@/src/io/import/importDataSources';
import {
  ImportResult,
  LoadableResult,
  VolumeResult,
  isLoadableResult,
  isVolumeResult,
} from '@/src/io/import/common';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useDatasetStore } from '@/src/store/datasets';
import { useMessageStore } from '@/src/store/messages';
import { Maybe } from '@/src/types';
import { logError } from '@/src/utils/loggers';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useToast } from '@/src/composables/useToast';
import { TYPE } from 'vue-toastification';
import { ToastID, ToastOptions } from 'vue-toastification/dist/types/types';
import { useLayersStore } from './datasets-layers';
import { useSegmentGroupStore } from './segmentGroups';
import { nonNullable } from '../utils';

// higher value priority is preferred for picking a primary selection
const BASE_MODALITY_TYPES = {
  CT: { priority: 3 },
  MR: { priority: 3 },
  US: { priority: 2 },
  DX: { priority: 1 },
} as const;

const NotificationMessages = {
  Loading: 'Loading datasets...',
  Done: 'Datasets loaded!',
  Error: 'Some files failed to load',
};

const LoadingToastOptions = {
  type: TYPE.INFO,
  timeout: false,
  closeButton: false,
  closeOnClick: false,
} satisfies ToastOptions;

function useLoadingNotifications() {
  const messageStore = useMessageStore();

  const loadingCount = ref(0);
  const loadingError = ref<Maybe<Error>>();

  const startLoading = () => {
    loadingCount.value += 1;
  };

  const stopLoading = () => {
    if (loadingCount.value === 0) return;
    loadingCount.value -= 1;
  };

  const setError = (err: Error) => {
    loadingError.value = err;
  };

  const toast = useToast();
  let toastID: Maybe<ToastID> = null;

  const showLoadingToast = () => {
    if (toastID == null) {
      toastID = toast.info(NotificationMessages.Loading, LoadingToastOptions);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Loading,
        options: LoadingToastOptions,
      });
    }
  };

  const showResults = () => {
    if (toastID == null) return;
    const error = loadingError.value;
    loadingError.value = null;

    if (error) {
      logError(error);
      toast.dismiss(toastID);
      messageStore.addError(NotificationMessages.Error, error);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Done,
        options: {
          type: TYPE.SUCCESS,
          timeout: 3000,
          closeButton: 'button',
          closeOnClick: true,
          onClose() {
            toastID = null;
          },
        },
      });
    }
  };

  watch(loadingCount, (count) => {
    if (count) showLoadingToast();
    else showResults();
  });

  const isLoading = computed(() => {
    return loadingCount.value > 0;
  });

  return {
    isLoading,
    startLoading,
    stopLoading,
    setError,
  };
}

function pickBaseDicom(loadableDataSources: Array<LoadableResult>) {
  // pick dicom dataset as primary selection if available
  const dicoms = loadableDataSources.filter(
    ({ dataType }) => dataType === 'dicom'
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

// returns image and dicom sources, no config files
function pickLoadableDataSources(
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  return succeeded.flatMap((result) => {
    return result.data.filter(isLoadableResult);
  });
}

// Returns list of dataSources with file names where the name has the extension argument
// and the start of the file name matches the primary file name.
function pickMatchingNames(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>,
  extension: string = 'segmentation'
) {
  const primaryName = getDataSourceName(primaryDataSource.dataSource);
  if (!primaryName) return [];
  const primaryNamePrefix = primaryName.split('.').slice(0, 1).join();
  return pickLoadableDataSources(succeeded)
    .filter((ds) => ds !== primaryDataSource)
    .map((importResult) => ({
      importResult,
      name: getDataSourceName(importResult.dataSource),
    }))
    .filter(({ name }) => {
      if (!name) return false;
      const extensions = name.split('.').slice(1);
      const hasExtension = extensions.includes(extension);
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

function pickBaseDataSource(
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  const loadableDataSources = pickLoadableDataSources(succeeded);
  const baseDicom = pickBaseDicom(loadableDataSources);
  return baseDicom ?? loadableDataSources[0];
}

function pickOtherVolumesInStudy(
  volumeID: string,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  const targetStudyUID = getStudyUID(volumeID);
  const dicomDataSources = pickLoadableDataSources(succeeded).filter(
    ({ dataType }) => dataType === 'dicom'
  );
  return dicomDataSources.filter((ds) => {
    const sourceStudyUID = getStudyUID(ds.dataID);
    return sourceStudyUID === targetStudyUID && ds.dataID !== volumeID;
  }) as Array<VolumeResult>;
}

// Layers a DICOM PET on a CT if found
function loadLayers(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  if (primaryDataSource.dataType !== 'dicom') return;
  const otherVolumesInStudy = pickOtherVolumesInStudy(
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

// Loads DICOM SEG modalities as Segment Groups if found
function loadSegmentations(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  const matchingNames = pickMatchingNames(
    primaryDataSource,
    succeeded,
    'segmentation'
  ).filter(isVolumeResult); // filter out models

  const dicomStore = useDICOMStore();
  const otherSegVolumesInStudy = pickOtherVolumesInStudy(
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

const useLoadDataStore = defineStore('loadData', () => {
  const { startLoading, stopLoading, setError, isLoading } =
    useLoadingNotifications();

  const wrapWithLoading = <T extends (...args: any[]) => void>(fn: T) => {
    return async function wrapper(...args: any[]) {
      try {
        startLoading();
        await fn(...args);
      } finally {
        stopLoading();
      }
    };
  };

  const loadDataSources = wrapWithLoading(async (sources: DataSource[]) => {
    const dataStore = useDatasetStore();

    let results: ImportDataSourcesResult[];
    try {
      results = await importDataSources(sources);
    } catch (error) {
      setError(error as Error);
      return;
    }

    const [succeeded, errored] = partitionResults(results);

    if (!dataStore.primarySelection && succeeded.length) {
      const primaryDataSource = pickBaseDataSource(succeeded);
      if (isVolumeResult(primaryDataSource)) {
        const selection = toDataSelection(primaryDataSource);
        dataStore.setPrimarySelection(selection);
        loadLayers(primaryDataSource, succeeded);
        loadSegmentations(primaryDataSource, succeeded);
      } // then must be primaryDataSource.type === 'model'
    }

    if (errored.length) {
      const errorMessages = errored.map((errResult) => {
        // pick first error
        const [firstError] = errResult.errors;
        // pick innermost dataset that errored
        const name = getDataSourceName(firstError.inputDataStackTrace[0]);
        // log error for debugging
        logError(firstError.cause);
        return `- ${name}: ${firstError.message}`;
      });
      const failedError = new Error(
        `These files failed to load:\n${errorMessages.join('\n')}`
      );

      setError(failedError);
    }
  });

  return {
    isLoading,
    loadDataSources,
  };
});

export default useLoadDataStore;
