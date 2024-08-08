import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import { FileSource } from '@/src/io/import/dataSource';
import * as DICOM from '@/src/io/dicom';
import { identity, pick, removeFromArray } from '../utils';
import { useImageStore } from './datasets-images';
import { useFileStore } from './datasets-files';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

export function imageCacheMultiKey(offset: number, asThumbnail: boolean) {
  return `${offset}!!${asThumbnail}`;
}

export interface VolumeKeys {
  patientKey: string;
  studyKey: string;
  volumeKey: string;
}

export interface PatientInfo {
  PatientID: string;
  PatientName: string;
  PatientBirthDate: string;
  PatientSex: string;
}

export interface StudyInfo {
  StudyID: string;
  StudyInstanceUID: string;
  StudyDate: string;
  StudyTime: string;
  AccessionNumber: string;
  StudyDescription: string;
}

export interface VolumeInfo {
  NumberOfSlices: number;
  VolumeID: string;
  Modality: string;
  SeriesInstanceUID: string;
  SeriesNumber: string;
  SeriesDescription: string;
  WindowLevel: string;
  WindowWidth: string;
}

interface State {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

  // Avoid recomputing image data for the same volume by checking this for existing buildVolume tasks
  volumeImageData: Record<string, Promise<vtkImageData>>;

  // patientKey -> patient info
  patientInfo: Record<string, PatientInfo>;
  // patientKey -> array of studyKeys
  patientStudies: Record<string, string[]>;

  // studyKey -> study info
  studyInfo: Record<string, StudyInfo>;
  // studyKey -> array of volumeKeys
  studyVolumes: Record<string, string[]>;

  // volumeKey -> volume info
  volumeInfo: Record<string, VolumeInfo>;

  // parent pointers
  // volumeKey -> studyKey
  volumeStudy: Record<string, string>;
  // studyKey -> patientKey
  studyPatient: Record<string, string>;
}

const readDicomTags = (file: File) =>
  DICOM.readTags(file, [
    { name: 'PatientName', tag: '0010|0010', strconv: true },
    { name: 'PatientID', tag: '0010|0020', strconv: true },
    { name: 'PatientBirthDate', tag: '0010|0030' },
    { name: 'PatientSex', tag: '0010|0040' },
    { name: 'StudyInstanceUID', tag: '0020|000d' },
    { name: 'StudyDate', tag: '0008|0020' },
    { name: 'StudyTime', tag: '0008|0030' },
    { name: 'StudyID', tag: '0020|0010', strconv: true },
    { name: 'AccessionNumber', tag: '0008|0050' },
    { name: 'StudyDescription', tag: '0008|1030', strconv: true },
    { name: 'Modality', tag: '0008|0060' },
    { name: 'SeriesInstanceUID', tag: '0020|000e' },
    { name: 'SeriesNumber', tag: '0020|0011' },
    { name: 'SeriesDescription', tag: '0008|103e', strconv: true },
    { name: 'WindowLevel', tag: '0028|1050' },
    { name: 'WindowWidth', tag: '0028|1051' },
  ]);

/**
 * Trims and collapses multiple spaces into one.
 * @param name
 * @returns string
 */
const cleanupName = (name: string) => {
  return name.trim().replace(/\s+/g, ' ');
};

export const getDisplayName = (info: VolumeInfo) => {
  return (
    cleanupName(info.SeriesDescription || info.SeriesNumber) ||
    info.SeriesInstanceUID
  );
};

export const getWindowLevels = (info: VolumeInfo) => {
  const { WindowWidth, WindowLevel } = info;
  if (
    WindowWidth == null ||
    WindowLevel == null ||
    WindowWidth === '' ||
    WindowLevel === ''
  )
    return []; // missing tag
  const widths = WindowWidth.split('\\').map(parseFloat);
  const levels = WindowLevel.split('\\').map(parseFloat);
  if (
    widths.some((w) => Number.isNaN(w)) ||
    levels.some((l) => Number.isNaN(l))
  ) {
    console.error('Invalid WindowWidth or WindowLevel DICOM tags');
    return [];
  }
  if (widths.length !== levels.length) {
    console.error(
      'Different numbers of WindowWidth and WindowLevel DICOM tags'
    );
    return [];
  }
  return widths.map((width, i) => ({ width, level: levels[i] }));
};

const constructImage = async (volumeKey: string) => {
  const fileStore = useFileStore();
  const files = fileStore.getFiles(volumeKey);
  if (!files) throw new Error('No files for volume key');
  const image = vtkITKHelper.convertItkToVtkImage(
    await DICOM.buildImage(files)
  );
  return image;
};

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    sliceData: {},
    volumeImageData: {},
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeStudy: {},
    studyPatient: {},
    needsRebuild: {},
  }),
  actions: {
    async importFiles(datasets: FileSource[]) {
      if (!datasets.length) return [];

      const fileToDataSource = new Map(datasets.map((ds) => [ds.file, ds]));
      const allFiles = [...fileToDataSource.keys()];

      const volumeToFiles = await DICOM.splitAndSort(allFiles, identity);
      if (Object.keys(volumeToFiles).length === 0)
        throw new Error('No volumes categorized from DICOM file(s)');

      const fileStore = useFileStore();

      // Link VolumeKey and DatasetFiles in fileStore
      Object.entries(volumeToFiles).forEach(([volumeKey, files]) => {
        const volumeDatasetFiles = files.map((file) => {
          const source = fileToDataSource.get(file);
          if (!source)
            throw new Error('Did not match File with source DataSource');
          return source;
        });
        fileStore.add(volumeKey, volumeDatasetFiles);
      });

      await Promise.all(
        Object.entries(volumeToFiles).map(async ([volumeKey, files]) => {
          // Read tags of first file
          if (!(volumeKey in this.volumeInfo)) {
            const tags = await readDicomTags(files[0]);
            // TODO parse the raw string values
            const patient = {
              PatientID: tags.PatientID || ANONYMOUS_PATIENT_ID,
              PatientName: tags.PatientName || ANONYMOUS_PATIENT,
              PatientBirthDate: tags.PatientBirthDate || '',
              PatientSex: tags.PatientSex || '',
            };

            const study = pick(
              tags,
              'StudyID',
              'StudyInstanceUID',
              'StudyDate',
              'StudyTime',
              'AccessionNumber',
              'StudyDescription'
            );

            const volumeInfo = {
              ...pick(
                tags,
                'Modality',
                'SeriesInstanceUID',
                'SeriesNumber',
                'SeriesDescription',
                'WindowLevel',
                'WindowWidth'
              ),
              NumberOfSlices: files.length,
              VolumeID: volumeKey,
            };

            this._updateDatabase(patient, study, volumeInfo);
          }

          // invalidate any existing volume
          if (volumeKey in useImageStore().dataIndex) {
            // buildVolume requestor uses this as a rebuild hint
            this.needsRebuild[volumeKey] = true;
          }
        })
      );

      return Object.keys(volumeToFiles);
    },

    _updateDatabase(
      patient: PatientInfo,
      study: StudyInfo,
      volume: VolumeInfo
    ) {
      const patientKey = patient.PatientID;
      const studyKey = study.StudyInstanceUID;
      const volumeKey = volume.VolumeID;

      if (!(patientKey in this.patientInfo)) {
        this.patientInfo[patientKey] = patient;
        this.patientStudies[patientKey] = [];
      }

      if (!(studyKey in this.studyInfo)) {
        this.studyInfo[studyKey] = study;
        this.studyVolumes[studyKey] = [];
        this.studyPatient[studyKey] = patientKey;
        this.patientStudies[patientKey].push(studyKey);
      }

      if (!(volumeKey in this.volumeInfo)) {
        this.volumeInfo[volumeKey] = volume;
        this.volumeStudy[volumeKey] = studyKey;
        this.sliceData[volumeKey] = {};
        this.studyVolumes[studyKey].push(volumeKey);
      }
    },

    // You should probably call datasetStore.remove instead as this does not
    // remove files/images/layers associated with the volume
    deleteVolume(volumeKey: string) {
      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        delete this.volumeInfo[volumeKey];
        delete this.sliceData[volumeKey];
        delete this.volumeStudy[volumeKey];

        if (volumeKey in this.volumeImageData) {
          delete this.volumeImageData[volumeKey];
        }

        removeFromArray(this.studyVolumes[studyKey], volumeKey);
        if (this.studyVolumes[studyKey].length === 0) {
          this._deleteStudy(studyKey);
        }
      }
    },

    _deleteStudy(studyKey: string) {
      if (studyKey in this.studyInfo) {
        const patientKey = this.studyPatient[studyKey];
        delete this.studyInfo[studyKey];
        delete this.studyPatient[studyKey];

        [...this.studyVolumes[studyKey]].forEach((volumeKey) =>
          this.deleteVolume(volumeKey)
        );
        delete this.studyVolumes[studyKey];

        removeFromArray(this.patientStudies[patientKey], studyKey);
        if (this.patientStudies[patientKey].length === 0) {
          this._deletePatient(patientKey);
        }
      }
    },

    _deletePatient(patientKey: string) {
      if (patientKey in this.patientInfo) {
        delete this.patientInfo[patientKey];

        [...this.patientStudies[patientKey]].forEach((studyKey) =>
          this._deleteStudy(studyKey)
        );
        delete this.patientStudies[patientKey];
      }
    },

    // returns an ITK image object
    async getVolumeSlice(
      volumeKey: string,
      sliceIndex: number,
      asThumbnail = false
    ) {
      const fileStore = useFileStore();

      const cacheKey = imageCacheMultiKey(sliceIndex, asThumbnail);
      if (
        volumeKey in this.sliceData &&
        cacheKey in this.sliceData[volumeKey]
      ) {
        return this.sliceData[volumeKey][cacheKey];
      }

      if (!(volumeKey in this.volumeInfo)) {
        throw new Error(`Cannot find given volume key: ${volumeKey}`);
      }
      const volumeInfo = this.volumeInfo[volumeKey];
      const numSlices = volumeInfo.NumberOfSlices;

      if (sliceIndex < 1 || sliceIndex > numSlices) {
        throw new Error(`Slice ${sliceIndex} is out of bounds`);
      }

      const volumeFiles = fileStore.getFiles(volumeKey);

      if (!volumeFiles) {
        throw new Error(`No files found for volume key: ${volumeKey}`);
      }

      const sliceFile = volumeFiles[sliceIndex - 1];

      const itkImage = await DICOM.readVolumeSlice(sliceFile, asThumbnail);

      this.sliceData[volumeKey][cacheKey] = itkImage;
      return itkImage;
    },

    // returns an ITK image object
    async getVolumeThumbnail(volumeKey: string) {
      const { NumberOfSlices } = this.volumeInfo[volumeKey];
      const middleSlice = Math.ceil(NumberOfSlices / 2);
      return this.getVolumeSlice(volumeKey, middleSlice, true);
    },

    async buildVolume(volumeKey: string, forceRebuild: boolean = false) {
      const imageStore = useImageStore();

      const alreadyBuilt = volumeKey in this.volumeImageData;
      const buildNeeded =
        forceRebuild || this.needsRebuild[volumeKey] || !alreadyBuilt;
      delete this.needsRebuild[volumeKey];

      // wait for old buildVolume call so we can run imageStore update side effects after
      const oldImagePromise = alreadyBuilt
        ? [this.volumeImageData[volumeKey]]
        : [];
      // actually build volume or wait for existing build?
      const newImagePromise = buildNeeded
        ? constructImage(volumeKey)
        : this.volumeImageData[volumeKey];
      // let other calls to buildVolume reuse this constructImage work
      this.volumeImageData[volumeKey] = newImagePromise;
      const [image] = await Promise.all([newImagePromise, ...oldImagePromise]);

      // update image store
      const imageExists = imageStore.dataIndex[volumeKey];
      if (imageExists) {
        // was a rebuild
        imageStore.updateData(volumeKey, image);
      } else {
        const info = this.volumeInfo[volumeKey];
        const name = getDisplayName(info);
        imageStore.addVTKImageData(name, image, volumeKey);
      }

      return image;
    },
  },
});
