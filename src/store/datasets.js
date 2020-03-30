import { FileTypes } from '../io/io';
import { MultipleErrors } from '../utils/errors';

function splitonce(str, delim) {
  const idx = str.indexOf(delim);
  if (idx > -1) {
    return [str.substr(0, idx), str.substr(idx + delim.length)];
  }
  return [str];
}

function makeDicomSelection(studyUID, seriesUID) {
  return `dicom;${studyUID}::${seriesUID}`;
}

function makeDataSelection(proxyID) {
  return `data;${proxyID}`;
}

export default ({ loader, dicomDB }) => ({
  namespaced: true,

  state: {
    // format: <type>;<id>
    // type can be either "dicom" or "data"
    // dicom id has format <studyID>:<seriesID>
    // data id has format <proxyID>
    selectedDataset: '',

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

  getters: {
    selectedDicomStudyUID: (state) => {
      const [type, id] = splitonce(state.selectedDataset, ';');
      if (type === 'dicom' && id) {
        const [studyUID] = splitonce(id, '::');
        return studyUID || null;
      }
      return null;
    },
    selectedDicomSeriesUID: (state) => {
      const [type, id] = splitonce(state.selectedDataset, ';');
      if (type === 'dicom' && id) {
        const seriesUID = splitonce(id, '::')[1];
        return seriesUID || null;
      }
      return null;
    },
    selectedDataProxyID: (state) => {
      const [type, id] = splitonce(state.selectedDataset, ';');
      return type === 'data' && id ? id : null;
    },
  },

  mutations: {
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
      // Can I assume studyUID:seriesUID will be practically unique,
      // or should I also include the (non-mandatory) patientID?
      const [studyUID, seriesUID] = selection;
      if (studyUID && seriesUID) {
        state.selectedDataset = makeDicomSelection(studyUID, seriesUID);
      }
    },

    /**
     * @param {object} dataInfo Of form { proxyID: number, name: string, type: string }
     */
    addDataset(state, dataInfo) {
      const { proxyID } = dataInfo;
      if (!(proxyID in state.dataIndex)) {
        state.data.push(proxyID);
        state.dataIndex[proxyID] = dataInfo;
      }
    },

    selectDataset(state, proxyID) {
      if (proxyID in state.dataIndex) {
        state.selectedDataset = makeDataSelection(proxyID);
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
    async loadFiles({ dispatch }, files) {
      const results = await Promise.allSettled(
        files.map((file) => dispatch('loadSingleFile', file)),
      );
      const rejected = results
        .map((result, index) => (result.status === 'rejected'
          ? { name: files[index].name, reason: result.reason }
          : null))
        .filter(Boolean);

      if (rejected.length) {
        console.log('ERROR', rejected);
        throw new MultipleErrors(rejected, 'Some files failed to load!');
      }

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
