import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { defineStore } from 'pinia';

import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useModelStore } from './datasets-models';
import { useView3DStore } from './views-3D';
import { extractArchivesRecursively, retypeFile, FILE_READERS } from '../io';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

const makeFileSuccessStatus = (
  file: File,
  type: 'model' | 'image',
  dataID: string
) =>
  ({
    type: 'file',
    loaded: true,
    filename: file.name,
    dataID,
    dataType: type,
  } as const);

export type FileLoadSuccess = ReturnType<typeof makeFileSuccessStatus>;

const makeFileFailureStatus = (file: File, reason: string) =>
  ({
    type: 'file',
    loaded: false,
    filename: file.name,
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
    return makeImageSelection(result.dataID);
  }
  throw new Error('Did not receive a valid LoadResult');
}

interface State {
  primarySelection: DataSelection | null;
}

export const useDatasetStore = defineStore('dataset', {
  state: (): State => ({
    primarySelection: null,
  }),
  getters: {
    primaryDataset(state): vtkImageData | null {
      const imageStore = useImageStore();
      const dicomStore = useDICOMStore();
      const sel = state.primarySelection;
      const { dataIndex } = imageStore;
      const { volumeToImageID } = dicomStore;

      if (sel?.type === 'dicom') {
        const id = volumeToImageID[sel.volumeKey];
        return dataIndex[id] || null;
      }
      if (sel?.type === 'image') {
        return dataIndex[sel.dataID] || null;
      }
      return null;
    },
    allDataIDs(): string[] {
      const imageStore = useImageStore();
      const modelStore = useModelStore();
      return [...imageStore.idList, ...modelStore.idList];
    },
    getDataProxyByID<T extends vtkObject>() {
      return (id: string) => {
        return this.$proxies.getData<T>(id);
      };
    },
  },
  actions: {
    async setPrimarySelection(sel: DataSelection) {
      this.primarySelection = sel;

      let imageID: string = '';

      // if selection is dicom, call buildVolume
      if (sel.type === 'image') {
        imageID = sel.dataID;
      } else if (sel.type === 'dicom') {
        // trigger dicom dataset building
        const dicomStore = useDICOMStore();
        await dicomStore.buildVolume(sel.volumeKey);
        imageID = dicomStore.volumeToImageID[sel.volumeKey];
      }

      // set 3D view's colorBy
      if (imageID) {
        const view3DStore = useView3DStore();
        const imageStore = useImageStore();
        view3DStore.setDefaultColorByFromImage(imageStore.dataIndex[imageID]);
      }
    },
    async loadFiles(files: File[]): Promise<LoadResult[]> {
      const imageStore = useImageStore();
      const modelStore = useModelStore();
      const dicomStore = useDICOMStore();

      const typedFiles = await Promise.all(files.map((f) => retypeFile(f)));

      // process archives
      const allFiles = await extractArchivesRecursively(typedFiles);

      const dicoms = allFiles.filter(({ type }) => type === 'dcm');
      const otherFiles = allFiles.filter(({ type }) => type !== 'dcm');

      const dicomStatus = dicomStore
        .importFiles(dicoms)
        .then((volumeKeys) =>
          volumeKeys.map((volKey) => makeDICOMSuccessStatus(volKey.volumeKey))
        )
        .catch((err) => [makeDICOMFailureStatus(err)]);

      const otherStatuses = Promise.all([
        ...otherFiles.map(async (file) => {
          const reader = FILE_READERS.get(file.type);
          if (reader) {
            try {
              const dataObj = await reader(file);
              if (dataObj.isA('vtkImageData')) {
                const id = imageStore.addVTKImageData(
                  file.name,
                  dataObj as vtkImageData
                );
                return makeFileSuccessStatus(file, 'image', id);
              }
              if (dataObj.isA('vtkPolyData')) {
                const id = modelStore.addVTKPolyData(
                  file.name,
                  dataObj as vtkPolyData
                );
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
    },
  },
});
