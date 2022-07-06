import vtkITKHelper from '@kitware/vtk.js/Common/DataModel/ITKHelper';
import { set, del } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { DICOMIOInst } from '../constants';
import { getCurrentInstance } from '../instances';
import { DICOMIO } from '../io/dicom';
import { pick, removeFromArray } from '../utils';
import { useImageStore } from './datasets-images';

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
  sliceData: Record<string, Record<string, object>>;

  // volumeKey -> imageID
  volumeToImageID: Record<string, string>;
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
    async importFiles(files: File[]) {
      const dicomIO = getCurrentInstance<DICOMIO>(DICOMIOInst);

      if (!files.length) {
        return [];
      }

      const updatedVolumes = await dicomIO.importFiles(files);
      const updatedVolumeKeys: VolumeKeys[] = []; // to be returned to caller

      await Promise.all(
        updatedVolumes.map(async (volumeKey) => {
          const numberOfSlices = await dicomIO.buildVolumeList(volumeKey);

          if (!(volumeKey in this.volumeInfo)) {
            const info = await dicomIO.readTags(volumeKey, [
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

            // TODO parse the raw string values
            const patient = {
              PatientID: info.PatientID || ANONYMOUS_PATIENT_ID,
              PatientName: info.PatientName || ANONYMOUS_PATIENT,
              PatientBirthDate: info.PatientBirthDate || '',
              PatientSex: info.PatientSex || '',
            };
            const patientKey = genSynPatientKey(patient);

            const studyKey = info.StudyInstanceUID;
            const study = pick(
              info,
              'StudyID',
              'StudyInstanceUID',
              'StudyDate',
              'StudyTime',
              'AccessionNumber',
              'StudyDescription'
            );

            const volumeInfo = {
              ...pick(
                info,
                'Modality',
                'SeriesInstanceUID',
                'SeriesNumber',
                'SeriesDescription'
              ),
              NumberOfSlices: numberOfSlices,
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
          imageStore.deleteData(imageID);
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

        this.studyVolumes[studyKey].forEach((volumeKey) =>
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

        this.patientStudies[patientKey].forEach((studyKey) =>
          this.deleteStudy(studyKey)
        );
        del(this.patientStudies, patientKey);
      }
    },

    // returns an ITK image object
    async getVolumeSlice(
      volumeKey: string,
      sliceIndex: number,
      asThumbnail = false
    ): Promise<object> {
      const dicomIO = getCurrentInstance<DICOMIO>(DICOMIOInst);

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

      const itkImage = dicomIO.getVolumeSlice(
        volumeKey,
        sliceIndex,
        asThumbnail
      );

      set(this.sliceData[volumeKey], cacheKey, itkImage);
      return itkImage;
    },

    async buildVolume(volumeKey: string, forceRebuild: boolean = false) {
      const imageStore = useImageStore();
      const dicomIO = getCurrentInstance<DICOMIO>(DICOMIOInst);

      const rebuild = forceRebuild || this.needsRebuild[volumeKey];

      if (!rebuild && volumeKey in this.volumeToImageID) {
        return imageStore.dataIndex[this.volumeToImageID[volumeKey]];
      }

      if (!(volumeKey in this.volumeInfo)) {
        throw new Error(`Cannot find given volume key: ${volumeKey}`);
      }

      const itkImage = await dicomIO.buildVolume(volumeKey);
      const vtkImage = vtkITKHelper.convertItkToVtkImage(itkImage);

      if (volumeKey in this.volumeToImageID) {
        const imageID = this.volumeToImageID[volumeKey];
        imageStore.updateData(imageID, vtkImage);
      } else {
        const name = this.volumeInfo[volumeKey].SeriesInstanceUID;
        const imageID = imageStore.addVTKImageData(name, vtkImage);
        set(this.volumeToImageID, volumeKey, imageID);
        set(this.imageIDToVolumeKey, imageID, volumeKey);
      }

      del(this.needsRebuild, volumeKey);

      return vtkImage;
    },
  },
});
