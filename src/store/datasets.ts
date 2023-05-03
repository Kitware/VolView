import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import { defineStore } from 'pinia';
import { computed, ref } from '@vue/composition-api';
import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useModelStore } from './datasets-models';
import { DatasetFile, useFileStore } from './datasets-files';
import { StateFile, Dataset } from '../io/state-file/schema';
import { useErrorMessage } from '../composables/useErrorMessage';
import {
  DataSource,
  convertDatasetFileToDataSource,
  importDataSources,
} from '../core/importDataSources';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

const makeFileSuccessStatus = (
  file: File | string,
  type: 'model' | 'image',
  dataID: string
) =>
  ({
    type: 'file',
    loaded: true,
    filename: typeof file === 'string' ? file : file.name,
    dataID,
    dataType: type,
  } as const);

export type FileLoadSuccess = ReturnType<typeof makeFileSuccessStatus>;

export const makeFileFailureStatus = (file: File | string, reason: string) =>
  ({
    type: 'file',
    loaded: false,
    filename: typeof file === 'string' ? file : file.name,
    error: new Error(reason),
  } as const);

export type FileLoadFailure = ReturnType<typeof makeFileFailureStatus>;

const makeDICOMSuccessStatus = (volumeKey: string) =>
  ({
    type: 'dicom',
    loaded: true,
    dataID: volumeKey,
    dataType: 'dicom',
  } as const);

export type DICOMLoadSuccess = ReturnType<typeof makeDICOMSuccessStatus>;

const makeDICOMFailureStatus = (error: Error) =>
  ({
    type: 'dicom',
    loaded: false,
    error,
  } as const);

export type DICOMLoadFailure = ReturnType<typeof makeDICOMFailureStatus>;

export type FileLoadResult = FileLoadSuccess | FileLoadFailure;
export type DICOMLoadResult = DICOMLoadSuccess | DICOMLoadFailure;
export type LoadResult = FileLoadResult | DICOMLoadResult;

export const makeDICOMSelection = (volumeKey: string) =>
  ({
    type: 'dicom',
    volumeKey,
  } as const);

export type DICOMSelection = ReturnType<typeof makeDICOMSelection>;

export const makeImageSelection = (imageID: string) =>
  ({
    type: 'image',
    dataID: imageID,
  } as const);

export type ImageSelection = ReturnType<typeof makeImageSelection>;

export type DataSelection = DICOMSelection | ImageSelection;

export const getImageID = (selection: DataSelection) => {
  if (selection.type === 'image') return selection.dataID;
  if (selection.type === 'dicom')
    return useDICOMStore().volumeToImageID[selection.volumeKey]; // volume selected, but image may not have been made yet

  const _exhaustiveCheck: never = selection;
  throw new Error(`invalid selection type ${_exhaustiveCheck}`);
};

export const getImage = async (selection: DataSelection) => {
  const images = useImageStore();
  const dicoms = useDICOMStore();
  if (selection.type === 'dicom') {
    // ensure image data exists
    await useErrorMessage('Failed to build volume', () =>
      dicoms.buildVolume(selection.volumeKey)
    );
    return images.dataIndex[getImageID(selection)!];
  }
  // just an image that should be in dataIndex
  return images.dataIndex[selection.dataID];
};

// Converts imageID to VolumeKey if exists, else return input imageID
export const getDataID = (imageID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.imageIDToVolumeKey[imageID] ?? imageID;
};

// Pass VolumeKey or ImageID and get ImageID
export const findImageID = (dataID: string) => {
  const dicomStore = useDICOMStore();
  return dicomStore.volumeToImageID[dataID] ?? dataID;
};

export function selectionEquals(s1: DataSelection, s2: DataSelection) {
  if (s1.type === 'dicom' && s2.type === 'dicom') {
    return s1.volumeKey === s2.volumeKey;
  }
  if (s1.type === 'image' && s2.type === 'image') {
    return s1.dataID === s2.dataID;
  }
  return false;
}

export function convertSuccessResultToDataSelection(
  result: FileLoadSuccess | DICOMLoadSuccess
) {
  if (result.type === 'dicom') {
    return makeDICOMSelection(result.dataID);
  }
  if (result.type === 'file') {
    if (result.dataType === 'image') {
      return makeImageSelection(result.dataID);
    }
  }
  return null;
}

export const useDatasetStore = defineStore('dataset', () => {
  type _This = ReturnType<typeof useDatasetStore>;

  const imageStore = useImageStore();
  const modelStore = useModelStore();
  const dicomStore = useDICOMStore();
  const fileStore = useFileStore();

  // --- state --- //

  const primarySelection = ref<DataSelection | null>(null);

  // --- getters --- //

  const primaryImageID = computed(() => {
    if (primarySelection.value) return getImageID(primarySelection.value);
    return undefined;
  });

  const primaryDataset = computed<vtkImageData | null>(() => {
    const { dataIndex } = imageStore;
    return (primaryImageID.value && dataIndex[primaryImageID.value]) || null;
  });

  const allDataIDs = computed(() => {
    return [...imageStore.idList, ...modelStore.idList];
  });

  function getDataProxyByID<T extends vtkObject>(this: _This, id: string) {
    return this.$proxies.getData<T>(id);
  }

  // --- actions --- //

  function setPrimarySelection(sel: DataSelection | null) {
    primarySelection.value = sel;

    if (sel === null) {
      return;
    }

    // if selection is dicom, call buildVolume
    if (sel.type === 'dicom') {
      useErrorMessage('Failed to build volume', () =>
        dicomStore.buildVolume(sel.volumeKey)
      );
    }
  }

  async function loadFiles(files: DatasetFile[]) {
    const resources = files.map((file): DataSource => {
      // treat empty remote files as just URLs to download
      return convertDatasetFileToDataSource(file, {
        forceRemoteOnly: file.file.size === 0,
      });
    });

    const { dicoms, results } = await importDataSources(resources);
    const statuses: LoadResult[] = [];

    try {
      const volumeKeys = await dicomStore.importFiles(dicoms);
      volumeKeys.forEach((key) => {
        statuses.push(makeDICOMSuccessStatus(key));
      });
    } catch (err) {
      statuses.push(makeDICOMFailureStatus(err as any));
    }

    // map import results to load statuses
    statuses.push(
      ...results.flatMap((result) => [
        ...result.data
          .filter(({ dataSource }) => !!dataSource.fileSrc)
          .map(({ dataID, dataType, dataSource }) =>
            makeFileSuccessStatus(dataSource.fileSrc!.file, dataType, dataID)
          ),
        ...result.errors
          .map((error) => ({
            reason: error.message,
            // find the innermost data source that has a fileSrc and get the file
            file: error.inputDataStackTrace.find((src) => !!src.fileSrc)
              ?.fileSrc?.file,
          }))
          .filter(({ file }) => !!file)
          .map(({ file, reason }) => makeFileFailureStatus(file!, reason)),
      ])
    );

    return statuses;
  }

  async function serialize(stateFile: StateFile) {
    await dicomStore.serialize(stateFile);
    await imageStore.serialize(stateFile);

    if (primarySelection.value !== null) {
      let id = null;
      if (primarySelection.value.type === 'dicom') {
        id = primarySelection.value.volumeKey;
      } else {
        id = primarySelection.value.dataID;
      }

      const { manifest } = stateFile;
      manifest.primarySelection = id;
    }
  }

  async function deserialize(dataSet: Dataset, files: DatasetFile[]) {
    const loadResults = await loadFiles(files);
    if (loadResults.length !== 1) {
      throw new Error('Invalid state file.');
    }
    return loadResults[0];
  }

  // --- watch for deletion --- //

  imageStore.$onAction(({ name, args, after }) => {
    if (name !== 'deleteData') {
      return;
    }
    after(() => {
      const [id] = args;
      const sel = primarySelection.value;
      if (sel?.type === 'image' && sel.dataID === id) {
        primarySelection.value = null;
      }
      // remove file store entry
      fileStore.remove(id);
    });
  });

  dicomStore.$onAction(({ name, args, after }) => {
    if (name !== 'deleteVolume') {
      return;
    }

    after(() => {
      const [volumeKey] = args;
      const sel = primarySelection.value;
      if (sel?.type === 'dicom' && volumeKey === sel.volumeKey) {
        primarySelection.value = null;
      }

      fileStore.remove(volumeKey);
    });
  });

  return {
    primarySelection,
    primaryDataset,
    allDataIDs,
    getDataProxyByID,
    setPrimarySelection,
    loadFiles,
    serialize,
    deserialize,
  };
});
