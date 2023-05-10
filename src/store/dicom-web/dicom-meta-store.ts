import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import {
  ANONYMOUS_PATIENT,
  ANONYMOUS_PATIENT_ID,
  PatientInfo,
  StudyInfo,
  VolumeInfo,
} from '../datasets-dicom';
import { pick, removeFromArray } from '../../utils';
import { Instance } from '../../core/dicom-web-api';

interface InstanceInfo {
  SopInstanceUID: string;
  InstanceNumber: string;
  Rows: number;
  Columns: number;
}

type VolumeInfoForUi = Omit<VolumeInfo, 'layers'>;

interface State {
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

    deleteVolume(volumeKey: string) {
      if (volumeKey in this.volumeInfo) {
        const studyKey = this.volumeStudy[volumeKey];
        del(this.volumeInfo, volumeKey);
        del(this.volumeStudy, volumeKey);

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

    _updateDatabase(
      patient: PatientInfo,
      study: StudyInfo,
      volume: VolumeInfoForUi,
      instance: InstanceInfo
    ) {
      const patientKey = patient.PatientID;
      if (patientKey && !(patientKey in this.patientInfo)) {
        set(this.patientInfo, patientKey, patient);
        set(this.patientStudies, patientKey, []);
      }

      const studyKey = study.StudyInstanceUID;
      if (studyKey && !(studyKey in this.studyInfo)) {
        set(this.studyInfo, studyKey, study);
        set(this.studyVolumes, studyKey, []);
        set(this.studyPatient, studyKey, patientKey);
        this.patientStudies[patientKey].push(studyKey);
      }

      const volumeKey = volume.VolumeID;
      if (volumeKey && !(volumeKey in this.volumeInfo)) {
        set(this.volumeInfo, volumeKey, volume);
        set(this.volumeInstances, volumeKey, []);
        set(this.volumeStudy, volumeKey, studyKey);
        this.studyVolumes[studyKey].push(volumeKey);
      }

      const instanceKey = instance.SopInstanceUID;
      if (instanceKey && !(instanceKey in this.instanceInfo)) {
        set(this.instanceInfo, instanceKey, instance);
        set(this.instanceVolume, instanceKey, volumeKey);
        this.volumeInstances[volumeKey].push(instanceKey);

        this.volumeInfo[volumeKey].NumberOfSlices += 1;
      }

      // Clean orphaned patients. Anonymous Patient loses its only study
      // when slices are loaded with full DICOM tags. Study was anonymous
      // because url deep linked into a study
      Object.entries(this.patientStudies).forEach(([key, studies]) => {
        if (studies.length === 0) {
          this.deletePatient(key);
        }
      });
    },
  },
});
