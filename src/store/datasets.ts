import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useModelStore } from './datasets-models';
import { extractArchivesRecursively, retypeFile, FILE_READERS } from '../io';
import { DatasetFile, useFileStore } from './datasets-files';
import { StateFile, DatasetType, Dataset } from '../io/state-file/schema';
import { readRemoteManifestFile } from '../io/manifest';
import { partition } from '../utils';
import { useErrorMessage } from '../composables/useErrorMessage';

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

  async function loadFiles(files: DatasetFile[]): Promise<LoadResult[]> {
    let allFiles = await Promise.all(
      files.map(async ({ file, ...rest }) => ({
        file: await retypeFile(file),
        ...rest,
      }))
    );

    // process any json manifests
    const [manifestFiles, nonManifests] = partition(
      ({ file }) => file.type === 'json',
      allFiles
    );
    allFiles = nonManifests;

    const manifestStatuses: FileLoadResult[] = [];
    if (manifestFiles.length) {
      await Promise.all(
        manifestFiles.map(async (file) => {
          try {
            allFiles.push(...(await readRemoteManifestFile(file.file)));
          } catch (err) {
            manifestStatuses.push(
              makeFileFailureStatus(
                file.file,
                'Failed to parse or download manifest'
              )
            );
          }
        })
      );
    }

    // process archives
    const fileEntries = await extractArchivesRecursively(allFiles);

    const [dicoms, otherFiles] = partition(
      ({ file: { type } }) => type === 'dcm',
      fileEntries
    );

    const dicomStatus = dicomStore
      .importFiles(dicoms)
      .then((volumeKeys) =>
        volumeKeys.map((volKey) => makeDICOMSuccessStatus(volKey.volumeKey))
      )
      .catch((err) => [makeDICOMFailureStatus(err)]);

    const otherStatuses = Promise.all([
      ...otherFiles.map(async (datasetFile) => {
        const { file } = datasetFile;
        const reader = FILE_READERS.get(file.type);
        if (reader) {
          try {
            const dataObj = await reader(file);
            if (dataObj.isA('vtkImageData')) {
              const id = imageStore.addVTKImageData(
                file.name,
                dataObj as vtkImageData
              );
              fileStore.add(id, [datasetFile]);

              return makeFileSuccessStatus(file, 'image', id);
            }
            if (dataObj.isA('vtkPolyData')) {
              const id = modelStore.addVTKPolyData(
                file.name,
                dataObj as vtkPolyData
              );
              fileStore.add(id, [datasetFile]);

              return makeFileSuccessStatus(file, 'model', id);
            }
            return makeFileFailureStatus(
              file,
              `${file.name} did not result in a valid dataset`
            );
          } catch (e) {
            return makeFileFailureStatus(
              file,
              `Reading ${file.name} gave an error: ${e}`
            );
          }
        }
        // indicate an error has occurred
        return makeFileFailureStatus(file, `No reader for ${file.name}`);
      }),
    ]);

    const statuses = [...(await dicomStatus), ...(await otherStatuses)];
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
    // dicom
    if (dataSet.type === DatasetType.DICOM) {
      return dicomStore
        .deserialize(files)
        .then((volumeKey) => makeDICOMSuccessStatus(volumeKey))
        .catch((err) => makeDICOMFailureStatus(err));
    }

    // image
    if (files.length !== 1) {
      throw new Error('Invalid state file.');
    }
    const datasetFile = files[0];
    const { file } = datasetFile;
    return imageStore
      .deserialize(datasetFile)
      .then((dataID) => makeFileSuccessStatus(file, 'image', dataID))
      .catch((err) =>
        makeFileFailureStatus(
          file.name,
          `Reading ${file.name} gave an error: ${err}`
        )
      );
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
