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
    patients: [],
    patientStudies: {},
    studySeries: {},
    seriesImages: {},
  },

  mutations: {
    setError(state, { name, error }) {
      state.errors = {
        ...state.errors,
        [name]: error,
      };
    },

    updatePatients(state, patients) {
      state.patients = patients;
    },

    updateStudies(state, patientStudies) {
      state.patientStudies = patientStudies;
    },

    updateSeries(state, studySeries) {
      state.studySeries = studySeries;
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
        }
      });

      return dispatch('updateDICOM');
    },


    updateDICOM({ commit }) {
      dicomDB.postProcess();

      const patients = Array.from(dicomDB.getPatients());
      const patientStudies = { ...dicomDB.getPatientStudyMap() };
      const studySeries = { ...dicomDB.getStudySeriesMap() };
      const seriesImages = { ...dicomDB.getSeriesImagesMap() };

      commit('updatePatients', patients);
      commit('updateStudies', patientStudies);
      commit('updateSeries', studySeries);
      commit('updateImages', seriesImages);
    },
  },
});
