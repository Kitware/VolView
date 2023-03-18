import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { set, del } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { Image } from 'itk-wasm';
import { pick, removeFromArray } from '../utils';
import { useImageStore } from './datasets-images';
import { DatasetFile, useFileStore } from './datasets-files';
import { StateFile, DatasetType } from '../io/state-file/schema';
import { serializeData } from '../io/state-file/utils';
import { DICOMIO } from '../io/dicom';

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
}

/**
 * Generate a synthetic multi-key patient key from a Patient object.
 *
 * This key is used to try to uniquely identify a patient, since the PatientID
 * is not guaranteed to be unique (especially in the anonymous case).
 *
 * Required keys in the Patient object:
 * - PatientName
 * - PatientID
 * - PatientBirthDate
 * - PatientSex
 *
 * @param {Patient} patient
 */
export function genSynPatientKey(patient: PatientInfo) {
  const pid = patient.PatientID.trim();
  const name = patient.PatientName.trim();
  const bdate = patient.PatientBirthDate.trim();
  const sex = patient.PatientSex.trim();
  // we only care about making a unique key here. The
  // data doesn't actually matter.
  return [pid, name, bdate, sex].map((s) => s.replace('|', '_')).join('|');
}

interface State {
  // volumeKey -> imageCacheMultiKey -> ITKImage
  sliceData: Record<string, Record<string, Image>>;

  // volumeKey -> imageID
  volumeToImageID: Record<string, string | undefined>;
  // imageID -> volumeKey
  imageIDToVolumeKey: Record<string, string>;

  // volume invalidation information
  needsRebuild: Record<string, boolean>;

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

const readDicomTags = (dicomIO: DICOMIO, file: File) =>
  dicomIO.readTags(file, [
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
  ]);

export const useDICOMStore = defineStore('dicom', {
  state: (): State => ({
    sliceData: {},
    volumeToImageID: {},
    imageIDToVolumeKey: {},
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
    async importFiles(datasetFiles: DatasetFile[]) {
      if (!datasetFiles.length) return [];

      const dicomIO = this.$dicomIO;

      const fileToDatasetFile = new Map(
        datasetFiles.map((df) => [df.file, df])
      );
      const allFiles = [...fileToDatasetFile.keys()];

      const volumeToFiles = await dicomIO.categorizeFiles(allFiles);

      const fileStore = useFileStore();

      // Link VolumeKey and DatasetFiles in fileStore
      Object.entries(volumeToFiles).forEach(([volumeKey, files]) => {
        const volumeDatasetFiles = files.map((file) => {
          const datasetFile = fileToDatasetFile.get(file);
          if (!datasetFile)
            throw new Error('Did not match File with source DatasetFile');
          return datasetFile;
        });
        fileStore.add(volumeKey, volumeDatasetFiles);
      });

      const updatedVolumeKeys: VolumeKeys[] = [];

      await Promise.all(
        Object.entries(volumeToFiles).map(async ([volumeKey, files]) => {
          // Read tags of first file
          if (!(volumeKey in this.volumeInfo)) {
            const tags = await readDicomTags(dicomIO, files[0]);
            // TODO parse the raw string values
            const patient = {
              PatientID: tags.PatientID || ANONYMOUS_PATIENT_ID,
              PatientName: tags.PatientName || ANONYMOUS_PATIENT,
              PatientBirthDate: tags.PatientBirthDate || '',
              PatientSex: tags.PatientSex || '',
            };
            const patientKey = genSynPatientKey(patient);

            const studyKey = tags.StudyInstanceUID;
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
                'SeriesDescription'
              ),
              NumberOfSlices: files.length,
              VolumeID: volumeKey,
            };

            updatedVolumeKeys.push({
              patientKey,
              studyKey,
              volumeKey,
            });

            this._updateDatabase(patient, study, volumeInfo);
          }

          // invalidate any existing volume
          if (volumeKey in this.volumeToImageID) {
            // buildVolume requestor uses this as a rebuild hint
            set(this.needsRebuild, volumeKey, true);
          }
        })
      );

      return updatedVolumeKeys;
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
        set(this.patientInfo, patientKey, patient);
        set(this.patientStudies, patientKey, []);
      }

      if (!(studyKey in this.studyInfo)) {
        set(this.studyInfo, studyKey, study);
        set(this.studyVolumes, studyKey, []);
        set(this.studyPatient, studyKey, patientKey);
        this.patientStudies[patientKey].push(studyKey);
      }

      if (!(volumeKey in this.volumeInfo)) {
        set(this.volumeInfo, volumeKey, volume);
        set(this.volumeStudy, volumeKey, studyKey);
        set(this.sliceData, volumeKey, {});
        this.studyVolumes[studyKey].push(volumeKey);
      }
    },

    deleteVolume(volumeKey: string) {
      const imageStore = useImageStore();
      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        del(this.volumeInfo, volumeKey);
        del(this.sliceData, volumeKey);
        del(this.volumeStudy, volumeKey);

        if (volumeKey in this.volumeToImageID) {
          const imageID = this.volumeToImageID[volumeKey];
          imageStore.deleteData(imageID!);
          del(this.volumeToImageID, volumeKey);
          del(this.imageIDToVolumeKey, imageID);
        }

        removeFromArray(this.studyVolumes[studyKey], volumeKey);
        if (this.studyVolumes[studyKey].length === 0) {
          this.deleteStudy(studyKey);
        }
      }
    },

    deleteStudy(studyKey: string) {
      if (studyKey in this.studyInfo) {
        const patientKey = this.studyPatient[studyKey];
        del(this.studyInfo, studyKey);
        del(this.studyPatient, studyKey);

        [...this.studyVolumes[studyKey]].forEach((volumeKey) =>
          this.deleteVolume(volumeKey)
        );
        del(this.studyVolumes, studyKey);

        removeFromArray(this.patientStudies[patientKey], studyKey);
        if (this.patientStudies[patientKey].length === 0) {
          this.deletePatient(patientKey);
        }
      }
    },

    deletePatient(patientKey: string) {
      if (patientKey in this.patientInfo) {
        del(this.patientInfo, patientKey);

        [...this.patientStudies[patientKey]].forEach((studyKey) =>
          this.deleteStudy(studyKey)
        );
        del(this.patientStudies, patientKey);
      }
    },

    async serialize(stateFile: StateFile) {
      const dataIDs = Object.keys(this.volumeInfo);
      await serializeData(stateFile, dataIDs, DatasetType.DICOM);
    },

    async deserialize(files: DatasetFile[]) {
      return this.importFiles(files).then((volumeKeys) => {
        if (volumeKeys.length !== 1) {
          // Volumes are store individually so we should get one back.
          throw new Error('Invalid state file.');
        }

        return volumeKeys[0].volumeKey;
      });
    },

    // returns an ITK image object
    async getVolumeSlice(
      volumeKey: string,
      sliceIndex: number,
      asThumbnail = false
    ) {
      const dicomIO = this.$dicomIO;
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

      const itkImage = dicomIO.getVolumeSlice(sliceFile, asThumbnail);

      set(this.sliceData[volumeKey], cacheKey, itkImage);
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
      const dicomIO = this.$dicomIO;

      const rebuild = forceRebuild || this.needsRebuild[volumeKey];

      if (!rebuild && this.volumeToImageID[volumeKey]) {
        const imageID = this.volumeToImageID[volumeKey]!;
        return imageStore.dataIndex[imageID];
      }

      const fileStore = useFileStore();
      const files = fileStore.getFiles(volumeKey);
      if (!files) throw new Error('No files for volume key');
      const image = vtkITKHelper.convertItkToVtkImage(
        await dicomIO.buildImage(files)
      );

      const existingImageID = this.volumeToImageID[volumeKey];
      if (existingImageID) {
        imageStore.updateData(existingImageID, image);
      } else {
        const name = this.volumeInfo[volumeKey].SeriesInstanceUID;
        const imageID = imageStore.addVTKImageData(name, image);
        set(this.imageIDToVolumeKey, imageID, volumeKey);
        set(this.volumeToImageID, volumeKey, imageID);
      }

      del(this.needsRebuild, volumeKey);

      return image;
    },
  },
});
