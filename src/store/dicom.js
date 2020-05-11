import { pick } from '@/src/utils/common';

export const ANONYMOUS_PATIENT = '(Anonymous)';
export const ANONYMOUS_PATIENT_ID = 'ANONYMOUS';

export default (dependencies) => ({
  namespaced: true,

  state: {
    patientIndex: {},
    studyIndex: {},
    seriesIndex: {},
    imageIndex: {},
  },

  mutations: {
    upsertSeries(state, { seriesUID, info }) {
      // TODO parse the raw string values
      const patientID = info.PatientID || ANONYMOUS_PATIENT_ID;
      if (!(patientID in state.patientIndex)) {
        state.patientIndex[patientID] = {
          PatientID: patientID,
          PatientName: info.PatientName || ANONYMOUS_PATIENT,
          ...pick(info, ['PatientBirthDate', 'PatientSex']),
        };
      }

      const studyUID = info.StudyInstanceUID;
      if (!(studyUID in state.studyIndex)) {
        state.studyIndex[studyUID] = pick(info, [
          'StudyID',
          'StudyDate',
          'StudyTime',
          'AccessionNumber',
          'Description',
        ]);
      }

      state.seriesIndex[seriesUID] = {
        Modality: info.Modality,
        InstanceUID: info.SeriesInstanceUID,
        InstanceNumber: info.SeriesInstanceNumber,
        Description: info.SeriesDescription,
        // not standard dicom
        NumberOfSlices: info.NumberOfSlices,
      };
    },
  },

  actions: {
    async importFiles({ commit }, files) {
      const { dicomIO } = dependencies;
      const updatedSeriesInfo = await dicomIO.importFiles(files);
      const seriesUIDs = Object.keys(updatedSeriesInfo);
      for (let i = 0; i < seriesUIDs.length; i += 1) {
        const seriesUID = seriesUIDs[i];
        commit('upsertSeries', {
          seriesUID,
          info: updatedSeriesInfo[seriesUID],
        });
      }
    },
  },
});
