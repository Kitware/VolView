import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';

import { FileTypes } from '../io/io';
import { MultipleErrors } from '../utils/errors';
import { asMutation } from '../utils/common';
import { renderProxies } from '../vtk/proxyUtils';

function createVtkImageData(volume) {
  const ds = vtkImageData.newInstance({
    origin: volume.origin,
    spacing: volume.spacing,
    direction: volume.directions,
  });
  const da = vtkDataArray.newInstance({
    // TODO handle multi-component images
    numberOfComponents: 1,
    values: volume.pixelData,
  });
  ds.getPointData().setScalars(da);
  return ds;
}

function splitonce(str, delim) {
  const idx = str.indexOf(delim);
  if (idx > -1) {
    return [str.substr(0, idx), str.substr(idx + delim.length)];
  }
  return [str];
}

export function makeDicomSelection(studyUID, seriesUID) {
  return `dicom;${studyUID}::${seriesUID}`;
}

export function makeDataSelection(proxyID) {
  return `data;${proxyID}`;
}

export default ({ proxyManager, loader, dicomDB }) => ({
  namespaced: true,

  state: {
    // format: <type>;<id>
    // type can be either "dicom" or "data"
    // dicom id has format <studyID>:<seriesID>
    // data id has format <proxyID>
    selectedDataset: '',

    // selectedDataset:string -> { proxyID: number, name: string, type: string }
    selectionIndex: {},

    // PatientID -> Patient
    patientIndex: {},
    // StudyUID -> Study
    studyIndex: {},
    // SeriesUID -> Series
    seriesIndex: {},
    // SeriesUID -> [DicomImage]
    seriesImages: {},

    // The following have type proxyID[]
    images: [],
    labelmaps: [],
    geometry: [],
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

    addData(state, { selection, proxy }) {
      const meta = {
        proxyID: proxy.getProxyId(),
        type: proxy.getType(),
        name: proxy.getName(),
      };
      state.selectionIndex[selection] = meta;

      // dicom datasets are excluded
      if (selection.startsWith('data')) {
        if (meta.type === 'vtkLabelMap') {
          state.labelmaps.push(meta.proxyID);
        } else if (meta.type === 'vtkImageData') {
          state.images.push(meta.proxyID);
        } else if (meta.type === 'vtkPolyData') {
          state.geometry.push(meta.proxyID);
        } else {
          throw new Error(`Unknown data type: ${meta.type}`);
        }
      }
    },

    deleteData(state, selection) {
      delete state.selectionIndex[selection];
    },

    selectSeries(state, selection) {
      // Can I assume studyUID:seriesUID will be practically unique,
      // or should I also include the (non-mandatory) patientID?
      const [studyUID, seriesUID] = selection;
      if (studyUID && seriesUID) {
        state.selectedDataset = makeDicomSelection(studyUID, seriesUID);
      } else {
        state.selectedDataset = '';
      }
    },

    selectDataset(state, proxyID) {
      const selection = makeDataSelection(proxyID);
      if (selection in state.selectionIndex) {
        state.selectedDataset = selection;
      } else {
        state.selectedDataset = '';
      }
    },

    clearSelection(state) {
      state.selectedDataset = '';
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
    async loadSingleFile({ commit }, file) {
      if (await loader.getFileType(file) === FileTypes.DICOM) {
        await dicomDB.importFile(file);
      } else {
        const dataset = await loader.parseFile(file);
        const proxy = proxyManager.createProxy('Sources', 'TrivialProducer', {
          name: file.name,
        });
        proxy.setInputData(dataset);

        // register dataset
        commit('addData', {
          selection: makeDataSelection(proxy.getProxyId()),
          proxy,
        });
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

    async selectSeries({
      state, getters, commit, dispatch,
    }, selection) {
      commit('selectSeries', selection);

      const seriesUID = getters.selectedDicomSeriesUID;
      if (seriesUID) {
        const sel = state.selectedDataset;
        let proxy = state.selectionIndex[sel];
        if (!proxy) {
          const volume = await dicomDB.getSeriesAsVolume(seriesUID);
          const ds = createVtkImageData(volume);
          proxy = proxyManager.createProxy('Sources', 'TrivialProducer', {
            name: state.selectedDataset,
          });
          proxy.setInputData(ds);
          // assign studyID:seriesID to proxyID
          commit('addData', {
            selection: sel,
            proxy,
          });
        }
      }

      return dispatch('updateRendering');
    },

    selectDataset({ commit, dispatch }, proxyID) {
      commit('selectDataset', proxyID);
      return dispatch('updateRendering');
    },

    clearSelection: asMutation('clearSelection'),

    updateRendering({ state }) {
      const layers = [].concat(state.labelmaps, state.geometry);
      const baseImage = state.selectionIndex[state.selectedDataset];
      if (baseImage) {
        layers.unshift(baseImage.proxyID);
      }
      renderProxies(
        proxyManager,
        layers.map((id) => proxyManager.getProxyById(id)),
      );
    },
  },
});
