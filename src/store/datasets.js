import { FileTypes } from '../io/io';


export default ({ loader, dicomDB }) => ({
  namespaced: true,

  state: {
    errors: [],

    selectedPatientID: '',
    selectedStudyUID: '',
    selectedSeriesUID: '',

    // PatientID -> Patient
    patientIndex: {},
    // StudyUID -> Study
    studyIndex: {},
    // SeriesUID -> Series
    seriesIndex: {},
    // SeriesUID -> [DicomImage]
    seriesImages: {},

    // non-dicom data
    // [ proxyID: number, ... ]
    data: [],
    // proxyID -> { proxyID: number, name: string, type: DataType }
    dataIndex: {},
  },

  mutations: {
    addError(state, { name, reason }) {
      state.errors.push({ name, reason });
    },

    clearErrors(state) {
      state.errors = [];
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

    selectSeries(state, selection) {
      // Can I assume seriesUID will be unique across ALL series?
      const [patientID, studyUID, seriesUID] = selection;
      if (patientID && studyUID && seriesUID) {
        state.selectedPatientID = patientID;
        state.selectedStudyUID = studyUID;
        state.selectedSeriesUID = seriesUID;
      } else {
        state.selectedPatientID = '';
        state.selectedStudyUID = '';
        state.selectedSeriesUID = '';
      }
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
        files.map((file) => dispatch('loadSingleFile', file)),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const fileName = files[index].name;
          commit('addError', {
            name: fileName,
            reason: result.reason,
          });
        }
      });

      // update dicom db after importing it all into the db
      return dispatch('updateDICOM');
    },

    /**
     * Loads a single file
     *
     * @param {*} file
     */
    async loadSingleFile(_, file) {
      if (await loader.getFileType(file) === FileTypes.DICOM) {
        await dicomDB.importFile(file);
      } else {
        // const dataset = await loader.parseFile(file);
        // const proxy = proxyManager.createProxy('Sources', 'TrivialProducer', {
        //   name: file.name,
        // });
        // proxy.setInputData(dataset);

        // commit('addDataset', {
        //   name: proxy.getName(),
        //   proxyID: proxy.getProxyId(),
        //   dataType: proxy.getType(),
        // });
      }
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

    async selectSeries({ state, commit }, selection) {
      commit('selectSeries', selection);

      if (state.selectedSeriesUID) {
        await dicomDB.getSeriesAsVolume(state.selectedSeriesUID);
      }
    },
  },
});
