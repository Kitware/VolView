import { defineStore } from 'pinia';
import {
  ANONYMOUS_PATIENT,
  ANONYMOUS_PATIENT_ID,
  PatientInfo,
  StudyInfo,
  VolumeInfo,
} from '../datasets-dicom';
import { pick } from '../../utils';
import { Instance } from '../../core/dicom-web-api';

interface InstanceInfo {
  SopInstanceUID: string;
  InstanceNumber: string;
  Rows: number;
  Columns: number;
}

type VolumeInfoForUi = Omit<VolumeInfo, 'layers'>;

interface State {
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
  volumeInfo: Record<string, VolumeInfoForUi>;
  // volumeKey -> array of instanceKeys
  volumeInstances: Record<string, string[]>;

  // instanceKey -> instance info
  instanceInfo: Record<string, InstanceInfo>;

  // parent pointers
  // instanceKey -> volumeKey
  instanceVolume: Record<string, string>;
  // volumeKey -> studyKey
  volumeStudy: Record<string, string>;
  // studyKey -> patientKey
  studyPatient: Record<string, string>;
}

export const useDicomMetaStore = defineStore('dicom-meta', {
  state: (): State => ({
    volumeToImageID: {},
    imageIDToVolumeKey: {},
    patientInfo: {},
    patientStudies: {},
    studyInfo: {},
    studyVolumes: {},
    volumeInfo: {},
    volumeInstances: {},
    instanceInfo: {},
    instanceVolume: {},
    volumeStudy: {},
    studyPatient: {},
    needsRebuild: {},
  }),
  actions: {
    async importMeta(info: Instance) {
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
        NumberOfSlices: 0, // incremented later
        VolumeID: info.SeriesInstanceUID,
      };

      const instanceInfo = {
        ...pick(info, 'SopInstanceUID', 'InstanceNumber'),
        Rows: Number.parseInt(info.Rows, 10),
        Columns: Number.parseInt(info.Columns, 10),
      };

      this._updateDatabase(patient, study, volumeInfo, instanceInfo);
    },

    _updateDatabase(
      patient: PatientInfo,
      study: StudyInfo,
      volume: VolumeInfoForUi,
      instance: InstanceInfo
    ) {
      const patientKey = patient.PatientID;
      if (patientKey && !(patientKey in this.patientInfo)) {
        this.patientInfo[patientKey] = patient;
        this.patientStudies[patientKey] = [];
      }

      const studyKey = study.StudyInstanceUID;
      if (studyKey && !(studyKey in this.studyInfo)) {
        this.studyInfo[studyKey] = study;
        this.studyVolumes[studyKey] = [];
        this.studyPatient[studyKey] = patientKey;
        this.patientStudies[patientKey].push(studyKey);
      }

      const volumeKey = volume.VolumeID;
      if (volumeKey && !(volumeKey in this.volumeInfo)) {
        this.volumeInfo[volumeKey] = volume;
        this.volumeInstances[volumeKey] = [];
        this.volumeStudy[volumeKey] = studyKey;
        this.studyVolumes[studyKey].push(volumeKey);
      }

      const instanceKey = instance.SopInstanceUID;
      if (instanceKey && !(instanceKey in this.instanceInfo)) {
        this.instanceInfo[instanceKey] = instance;
        this.instanceVolume[instanceKey] = volumeKey;
        this.volumeInstances[volumeKey].push(instanceKey);

        this.volumeInfo[volumeKey].NumberOfSlices += 1;
      }
    },
  },
});
