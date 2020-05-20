import { pick } from '@/src/utils/common';

export const ANONYMOUS_PATIENT = 'Anonymous';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

/**
 * Generate a synthetic multi-key patient key from a Patient object.
 *
 * Required keys in the Patient object:
 * - PatientName
 * - PatientID
 * - PatientBirthDate
 * - PatientSex
 *
 * @param {Patient} patient
 */
export function genSynPatientKey(patient) {
  const pid = patient.PatientID.trim();
  const name = patient.PatientName.trim();
  const bdate = patient.PatientBirthDate.trim();
  const sex = patient.PatientSex.trim();
  // we only care about making a unique key here. The
  // data doesn't actually matter.
  return [pid, name, bdate, sex]
    .map((s) => s.replace('|', '_'))
    .join('|');
}

export default (dependencies) => ({
  namespaced: true,

  state: {
    patientIndex: {}, // patientKey -> Patient
    patientStudies: {}, // patientID -> [studyKey]; use patientID to combine Anonymous patients
    studyIndex: {}, // studyKey -> Study
    studySeries: {}, // studyUID -> [seriesKey]
    seriesIndex: {}, // seriesKey -> Series
    imageIndex: {},
  },

  mutations: {
    addPatient(state, { patientKey, patient }) {
      if (!(patientKey in state.patientIndex)) {
        state.patientIndex = {
          ...state.patientIndex,
          [patientKey]: patient,
        };
      }
    },

    addStudy(state, { studyKey, study, patientID }) {
      if (!(studyKey in state.studyIndex)) {
        state.studyIndex = {
          ...state.studyIndex,
          [studyKey]: study,
        };
        state.studyIndex[studyKey] = study;
        state.patientStudies[patientID] = state.patientStudies[patientID] ?? [];
        state.patientStudies[patientID].push(studyKey);
      }
    },

    addSeries(state, { seriesKey, series, studyUID }) {
      if (!(seriesKey in state.seriesIndex)) {
        state.seriesIndex = {
          ...state.seriesIndex,
          [seriesKey]: series,
        };
        state.studySeries[studyUID] = state.studySeries[studyUID] ?? [];
        state.studySeries[studyUID].push(seriesKey);
      }
    },
  },

  actions: {
    async importFiles({ commit }, files) {
      const { dicomIO } = dependencies;

      if (files.length === 0) {
        return [];
      }

      const updatedSeriesInfo = await dicomIO.importFiles(files);
      const seriesUIDs = Object.keys(updatedSeriesInfo);
      const updatedSeriesKeys = []; // to be returned to caller
      for (let i = 0; i < seriesUIDs.length; i += 1) {
        const seriesUID = seriesUIDs[i];
        const info = updatedSeriesInfo[seriesUID];

        // TODO parse the raw string values
        const patient = {
          PatientID: info.PatientID || ANONYMOUS_PATIENT_ID,
          PatientName: info.PatientName || ANONYMOUS_PATIENT,
          ...pick(info, ['PatientBirthDate', 'PatientSex']),
        };
        const patientKey = genSynPatientKey(patient);
        const patientID = patient.PatientID;

        const studyKey = info.StudyInstanceUID;
        const studyUID = studyKey;
        const study = pick(info, [
          'StudyID',
          'StudyInstanceUID',
          'StudyDate',
          'StudyTime',
          'AccessionNumber',
          'Description',
        ]);

        const seriesKey = info.SeriesInstanceUID;
        const series = pick(info, [
          'Modality',
          'SeriesInstanceUID',
          'SeriesNumber',
          'SeriesDescription',
          // not standard dicom
          'NumberOfSlices',
          'ITKGDCMSeriesUID',
        ]);

        updatedSeriesKeys.push({
          patientKey,
          studyKey,
          seriesKey,
        });

        commit('addPatient', { patientKey, patient });
        commit('addStudy', { studyKey, study, patientID });
        commit('addSeries', { seriesKey, series, studyUID });
      }
      return updatedSeriesKeys;
    },

    async getThumbnail(_, seriesUID) {
      const { dicomIO } = dependencies;
      return dicomIO.generateThumbnail(seriesUID);
    },
  },
});
