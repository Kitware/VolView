import { FileTypes } from '../io/io';

/**
 * Loads a single file
 *
 * Returns an object: {}
 * @param {*} file
 */
async function loadSingleFile(file, loader, dicomDB) {
  if (await loader.getFileType(file) === FileTypes.DICOM) {
    await dicomDB.importFile(file);
  } else {
    await loader.parseFile(file);
  }
}

export default ({ loader, dicomDB }) => ({
  namespaced: true,

  state: {
    errors: {},

    patientIndex: {},
    studyIndex: {},
    seriesIndex: {},
    seriesImages: {},
  },

  mutations: {
    setError(state, { name, error }) {
      state.errors = {
        ...state.errors,
        [name]: error,
      };
    },

    updatePatients(state, patientIndex) {
      state.patientIndex = patientIndex;
    },

    updateStudies(state, studyIndex) {
      state.studyIndex = studyIndex;
    },

    updateSeries(state, seriesIndex) {
      state.seriesIndex = seriesIndex;
    },

    updateImages(state, seriesImages) {
      state.seriesImages = seriesImages;
    },
  },

  actions: {

    /**
     * Loads a list of files into the application.
     *
     * Returns an object that maps file names to error objects.
     * If no errors are encountered, then the object is empty.
     * @param {[]File} files
     */
    async loadFiles({ commit, dispatch }, files) {
      const results = await Promise.allSettled(
        files.map((file) => loadSingleFile(file, loader, dicomDB)),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const fileName = files[index].name;
          commit('setError', fileName, result.reason);
          console.error('ERROR TODO', fileName, result.reason);
        }
      });

      return dispatch('updateDICOM');
    },


    async updateDICOM({ commit }) {
      await dicomDB.settleDatabase();

      const patientIndex = { ...dicomDB.getPatientIndex() };
      const studyIndex = { ...dicomDB.getStudyIndex() };
      const seriesIndex = { ...dicomDB.getSeriesIndex() };
      const seriesImages = { ...dicomDB.getSeriesImages() };

      commit('updatePatients', patientIndex);
      commit('updateStudies', studyIndex);
      commit('updateSeries', seriesIndex);
      commit('updateImages', seriesImages);
    },
  },
});
