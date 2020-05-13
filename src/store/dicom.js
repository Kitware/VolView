import { pick } from '@/src/utils/common';

export const ANONYMOUS_PATIENT = '(Anonymous)';
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
    patientIndex: {},
    studyIndex: {},
    seriesIndex: {},
    imageIndex: {},
  },

  mutations: {
    addPatient(state, { patientKey, patient }) {
      if (!(patientKey in state.patientIndex)) {
        state.patientIndex[patientKey] = patient;
      }
    },

    addStudy(state, { studyKey, study }) {
      if (!(studyKey in state.studyIndex)) {
        state.studyIndex[studyKey] = study;
      }
    },

    addSeries(state, { seriesKey, series }) {
      if (!(seriesKey in state.seriesIndex)) {
        state.seriesIndex[seriesKey] = series;
      }
    },
  },

  actions: {
    async importFiles({ commit }, files) {
      const { dicomIO } = dependencies;
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

        const studyKey = info.StudyInstanceUID;
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
        ]);

        updatedSeriesKeys.push({
          patientKey,
          studyKey,
          seriesKey,
        });

        commit('addPatient', { patientKey, patient });
        commit('addStudy', { studyKey, study });
        commit('addSeries', { seriesKey, series });
      }
      return updatedSeriesKeys;
    },
  },
});
