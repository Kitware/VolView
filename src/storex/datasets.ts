import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { defineStore } from 'pinia';

import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useModelStore } from './datasets-models';
import { extractArchivesRecursively, retypeFile } from '../io/newIO';
import { fileReaders } from '../io/newReaders';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

export interface FileLoadSuccess {
  type: 'file';
  filename: string;
  loaded: true;
  dataID: string;
  dataType: 'model' | 'image';
}

export interface FileLoadFailure {
  type: 'file';
  filename: string;
  loaded: false;
  error: Error;
}

export interface DICOMLoadSuccess {
  type: 'dicom';
  loaded: true;
  dataID: string;
  dataType: 'dicom';
}

export interface DICOMLoadFailure {
  type: 'dicom';
  loaded: false;
  error: Error;
}

export type FileLoadResult = FileLoadSuccess | FileLoadFailure;
export type DICOMLoadResult = DICOMLoadSuccess | DICOMLoadFailure;
export type LoadResult = FileLoadResult | DICOMLoadResult;

const makeFileSuccessStatus = (
  file: File,
  type: 'model' | 'image',
  dataID: string
): FileLoadSuccess => ({
  type: 'file',
  loaded: true,
  filename: file.name,
  dataID,
  dataType: type,
});

const makeFileFailureStatus = (
  file: File,
  reason: string
): FileLoadFailure => ({
  type: 'file',
  loaded: false,
  filename: file.name,
  error: new Error(reason),
});

const makeDICOMSuccessStatus = (volumeKey: string): DICOMLoadSuccess => ({
  type: 'dicom',
  loaded: true,
  dataID: volumeKey,
  dataType: 'dicom',
});

const makeDICOMFailureStatus = (error: Error): DICOMLoadFailure => ({
  type: 'dicom',
  loaded: false,
  error,
});

export type DICOMSelection = {
  type: 'dicom';
  volumeKey: string;
};

export type ImageSelection = {
  type: 'image';
  dataID: string;
};

export type DataSelection = DICOMSelection | ImageSelection;

interface State {
  primarySelection: DataSelection | null;
}

export const useDatasetStore = defineStore('datasets', {
  state: (): State => ({
    primarySelection: null,
  }),
  getters: {
    allDataIDs(): string[] {
      const imageStore = useImageStore();
      const modelStore = useModelStore();
      return [...imageStore.idList, ...modelStore.idList];
    },
  },
  actions: {
    setPrimarySelection(sel: DataSelection) {
      // TODO validate selection
      this.primarySelection = sel;
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
          volumeKeys.map((volKey) => makeDICOMSuccessStatus(volKey.patientKey))
        )
        .catch((err) => [makeDICOMFailureStatus(err)]);

      const otherStatuses = Promise.all([
        ...otherFiles.map(async (file) => {
          const reader = fileReaders.get(file.type);
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
