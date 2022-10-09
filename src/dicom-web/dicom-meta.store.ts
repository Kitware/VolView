import { set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import {
  ANONYMOUS_PATIENT,
  ANONYMOUS_PATIENT_ID,
  PatientInfo,
  StudyInfo,
  VolumeInfo,
} from '../store/datasets-dicom';
import { pick } from '../utils';
import { Instance } from './dicomWeb';

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

export const useDicomMetaStore = defineStore('dicom-meta', {
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
    async importInstance(info: Instance) {
      const patient = {
        PatientID: info.PatientID || ANONYMOUS_PATIENT_ID,
        PatientName: info.PatientName || ANONYMOUS_PATIENT,
        PatientBirthDate: info.PatientBirthDate || '',
        PatientSex: info.PatientSex || '',
      };

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
        NumberOfSlices: 1,
        VolumeID: info.SeriesInstanceUID,
      };

      this._updateDatabase(patient, study, volumeInfo);
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
  },
});
