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

const BASE_MODALITY_TYPES = ['CT', 'MR', 'DX', 'US'];

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
  return dicoms.find((dicomSource) => {
    const volumeInfo = dicomStore.volumeInfo[dicomSource.dataID];
    const modality = volumeInfo?.Modality;
    return BASE_MODALITY_TYPES.includes(modality);
  });
}

function getStudyUID(volumeID: string) {
  const dicomStore = useDICOMStore();
  const studyKey = dicomStore.volumeStudy[volumeID];
  return dicomStore.studyInfo[studyKey].StudyInstanceUID;
}

function pickLoadableDataSources(
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  return succeeded.flatMap((result) => {
    return result.data.filter(isLoadableResult);
  });
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
  const studyID = getStudyUID(volumeID);
  const dicomDataSources = pickLoadableDataSources(succeeded).filter(
    ({ dataType }) => dataType === 'dicom'
  );
  return dicomDataSources.filter((ds) => {
    const studyUID = getStudyUID(ds.dataID);
    return studyUID === studyID && ds.dataID !== volumeID;
  }) as Array<VolumeResult>;
}

// Layers a DICOM PET on a CT if found
function loadLayers(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  if (!isVolumeResult(primaryDataSource)) return;
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

// Loads DICOM SEG modalities to segmentations if found
function loadSegmentations(
  primaryDataSource: VolumeResult,
  succeeded: Array<PipelineResultSuccess<ImportResult>>
) {
  const otherVolumesInStudy = pickOtherVolumesInStudy(
    primaryDataSource.dataID,
    succeeded
  );

  const segmentGroupStore = useSegmentGroupStore();
  otherVolumesInStudy.forEach((ds) => {
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
      } // else primaryDataSource.type === 'model'
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
