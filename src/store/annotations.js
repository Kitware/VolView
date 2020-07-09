import Vue from 'vue';

import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { DEFAULT_LABELMAP_COLORS, NO_SELECTION } from '@/src/constants';

export function createLabelmapFromImage(imageData) {
  const labelmap = vtkLabelMap.newInstance(
    imageData.get('spacing', 'origin', 'direction'),
  );
  labelmap.setDimensions(imageData.getDimensions());

  const values = new Uint8Array(imageData.getNumberOfPoints());
  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values,
  });
  labelmap.getPointData().setScalars(dataArray);
  labelmap.computeTransforms();
  return labelmap;
}

export default () => ({
  namespaced: true,

  state: {
    // if paint enabled, selct first labelmap
    selectedLabelmap: NO_SELECTION,
    currentLabelFor: {}, // labelmap ID -> currently selected label
    labels: {}, // labelmapID -> label -> color
    radius: 1,
    radiusRange: [1, 100],
  },

  mutations: {
    setLabelColor(state, { labelmapID, label, color }) {
      if (!(labelmapID in state.labels)) {
        Vue.set(state.labels, labelmapID, {});
      }
      Vue.set(state.labels[labelmapID], label, color);
    },
    cloneColorMap(state, { labelmapID, colormap }) {
      Vue.set(state.labels, labelmapID, { ...colormap });
    },
    selectLabelmap(state, labelmapID) {
      state.selectedLabelmap = labelmapID;
    },
    selectLabel(state, { labelmapID, label }) {
      // assumes that label exists
      Vue.set(state.currentLabelFor, labelmapID, label);
    },
    deleteLabel(state, { labelmapID, label }) {
      if (labelmapID in state.labels) {
        Vue.delete(state.labels[labelmapID], label);
      }
    },
    setRadius(state, radius) {
      state.radius = radius;
    },
    setRadiusRange(state, { min, max }) {
      state.radiusRange = [min, max];
    },
    removeLabelmap(state, labelmapID) {
      Vue.delete(state.labels, labelmapID);
    },
  },

  actions: {
    async createLabelmap({ commit, dispatch, rootState }, baseID) {
      if (baseID in rootState.data.vtkCache) {
        const imageData = rootState.data.vtkCache[baseID];
        const id = rootState.data.nextID;
        const name = 'Labelmap';

        // create labelmap from imageData
        const labelmap = createLabelmapFromImage(imageData);
        commit('addLabelmap', { name, image: labelmap }, { root: true });

        // set default colormap
        labelmap.setColorMap(DEFAULT_LABELMAP_COLORS);
        commit('cloneColorMap', {
          labelmapID: id,
          colormap: DEFAULT_LABELMAP_COLORS,
        });

        // select default label
        commit('selectLabel', {
          labelmapID: id,
          label: 1, // DEFAULT_LABELMAP_COLORS has label 1
        });

        await dispatch('selectLabelmap', id);
        await dispatch({ type: 'updateScene', reset: false }, { root: true });
      }
    },

    selectLabelmap({ commit, rootState }, labelmapID) {
      if (rootState.data.labelmapIDs.includes(labelmapID)) {
        const labelmap = rootState.data.vtkCache[labelmapID];
        const dims = labelmap.getDimensions();
        const diag = Math.sqrt(dims.reduce((sum, d) => sum + d * d, 0));
        commit('setRadiusRange', {
          min: 1,
          max: Math.round(diag / 2),
        });
        commit('setRadius', Math.max(2, Math.round(Math.sqrt(diag / 2))));
        commit('selectLabelmap', labelmapID);
      }
    },

    setRadius({ commit }, radius) {
      commit('setRadius', radius);
    },

    setLabelColor({ commit, rootState }, { labelmapID, label, color }) {
      if (labelmapID in rootState.data.index) {
        commit('setLabelColor', { labelmapID, label, color });
        const labelmap = rootState.data.vtkCache[labelmapID];
        labelmap.setLabelColor(label, color);
      }
    },

    selectLabel({ commit, state }, { labelmapID, label }) {
      if (label in (state.labels[labelmapID] ?? {})) {
        commit('selectLabel', { labelmapID, label });
      }
    },

    deleteLabel({ commit }, { labelmapID, label }) {
      commit('deleteLabel', { labelmapID, label });
      // TODO loop through labelmap pixels and clear those with label
    },

    removeData({ commit, state }, dataID) {
      if (dataID === state.selectLabelmap) {
        commit('selectLabelmap', NO_SELECTION);
      }
    }
  },
});
