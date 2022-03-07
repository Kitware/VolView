import { isVtkObject } from '@kitware/vtk.js/macros';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import JSZip from 'jszip';
import { defineStore } from 'pinia';

import { FileIOInst } from '../constants';
import { getCurrentInstance } from '../instances';
import { FileIO, FileTypes } from '../io/io';
import { useMessageStore } from './messages';

import { useDICOMStore } from './datasets-dicom';
import { useImageStore } from './datasets-images';
import { useModelStore } from './datasets-models';

export const DataType = {
  Image: 'Image',
  Model: 'Model',
};

export interface FileLoadSuccess {
  filename: string;
  loaded: true;
  dataID: string;
}

export interface FileLoadFailure {
  filename: string;
  loaded: false;
  error: Error;
}

export interface DICOMLoadSuccess {
  dicom: true;
  loaded: true;
  // TODO? dataIDs: string[]
}

export interface DICOMLoadFailure {
  dicom: true;
  loaded: false;
  error: Error;
}

export type FileLoadResult = FileLoadSuccess | FileLoadFailure;
export type DICOMLoadResult = DICOMLoadSuccess | DICOMLoadFailure;
export type LoadResult = FileLoadResult | DICOMLoadResult;

function extractFromZip(zip: JSZip) {
  const promises: Promise<File>[] = [];
  zip.forEach((relPath, file) => {
    if (!file.dir) {
      const splitPath = file.name.split('/');
      const baseName = splitPath[splitPath.length - 1];
      const zipFile = zip.file(file.name);
      if (zipFile) {
        promises.push(
          zipFile.async('blob').then((blob) => new File([blob], baseName))
        );
      }
    }
  });
  return promises;
}

async function extractAllFilesFromZips(zips: File[]) {
  const allFilePromises = zips.map(async (zip) => {
    const loadedZip = await JSZip.loadAsync(zip);
    return Promise.all(extractFromZip(loadedZip));
  });
  const allFiles = await Promise.all(allFilePromises);
  return allFiles.flat();
}

export const useDatasetStore = defineStore('datasets', {
  getters: {
    allDataIDs(): string[] {
      const imageStore = useImageStore();
      const modelStore = useModelStore();
      return [...imageStore.idList, ...modelStore.idList];
    },
  },
  actions: {
    async loadFiles(files: File[]) {
      const fileIO = getCurrentInstance<FileIO>(FileIOInst);
      const dicomStore = useDICOMStore();
      const messageStore = useMessageStore();

      // Load all files from zip compressed uploads
      const zips: File[] = [];
      const rest: File[] = [];
      files.forEach((file) => {
        if (file.name.endsWith('zip')) {
          zips.push(file);
        } else {
          rest.push(file);
        }
      });
      const extractedFiles = await extractAllFilesFromZips(zips);
      const allFiles = [...rest, ...extractedFiles];

      const fileTypes = await Promise.all(
        files.map(async (file) => fileIO.getFileType(file))
      );

      const dicomFiles: File[] = [];
      const otherFiles: File[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = allFiles[i];
        const type = fileTypes[i];
        if (type === FileTypes.DICOM) {
          dicomFiles.push(file);
        } else {
          otherFiles.push(file);
        }
      }

      const [dicomLoadResult, otherLoadResult] = await Promise.allSettled([
        messageStore.runTaskWithMessage('Import DICOM Files', () =>
          dicomStore.importFiles(dicomFiles)
        ),
        await this.loadNonDICOMFiles(otherFiles),
      ]);

      let returnValue: LoadResult[] = [];

      if (otherFiles.length) {
        if (otherLoadResult.status === 'fulfilled') {
          returnValue = returnValue.concat(otherLoadResult.value);
        } else {
          otherFiles.forEach((file) => {
            returnValue.push({
              filename: file.name,
              loaded: false,
              error: new Error('Unknown error occurred'),
            } as FileLoadFailure);
          });
          messageStore.addError(
            'loadNonDICOMFiles failed',
            otherLoadResult.reason
          );
        }
      }

      if (dicomFiles.length) {
        if (dicomLoadResult.status === 'fulfilled') {
          returnValue.push({ dicom: true, loaded: true });
        } else {
          returnValue.push({
            dicom: true,
            loaded: false,
            error: dicomLoadResult.reason,
          });
          messageStore.addError(
            'import DICOM files failed',
            dicomLoadResult.reason
          );
        }
      }

      return returnValue;
    },

    async loadNonDICOMFiles(files: File[]) {
      const fileIO = getCurrentInstance<FileIO>(FileIOInst);
      const imageStore = useImageStore();
      const modelStore = useModelStore();
      const messageStore = useMessageStore();

      const loadResults = await Promise.allSettled(
        files.map(async (file) => {
          const obj = await messageStore.runTaskWithMessage(
            `Load "${file.name}"`,
            () => fileIO.readSingleFile(file)
          );
          if (isVtkObject(obj)) {
            if (obj.isA('vtkImageData')) {
              return imageStore.addVTKImageData(file.name, obj as vtkImageData);
            }
            if (obj.isA('vtkPolyData')) {
              return modelStore.addVTKPolyData(file.name, obj as vtkPolyData);
            }
          }
          return null;
        })
      );

      return loadResults.map((result, idx) => {
        if (result.status === 'fulfilled') {
          return {
            filename: files[idx].name,
            loaded: true,
            dataID: result.value as string | null,
          } as FileLoadSuccess;
        }
        return {
          filename: files[idx].name,
          loaded: false,
          error: result.reason,
        } as FileLoadFailure;
      });
    },
  },
});
