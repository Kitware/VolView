import Vue from 'vue';
import { asMutation } from '@/src/utils/common';

export default () => ({
  namespaced: true,

  state: {
    measurementWidgets: [], // list of widget ids
    measurements: {}, // widget ID -> opaque measurement obj
    // widget/measurement parent is the base image association
    parents: {}, // data ID -> [widget ID]
    widgetParent: {}, // widget ID -> data ID
  },

  mutations: {
    addMeasurementData(state, { id, type, parentID, initialData }) {
      if (!(id in state.measurements)) {
        state.measurementWidgets.push(id);
      }
      Vue.set(state.measurements, id, { type, data: initialData });

      if (!(parentID in state.parents)) {
        Vue.set(state.parents, parentID, []);
      }
      state.parents[parentID].push(id);
      Vue.set(state.widgetParent, id, parentID);
    },

    setMeasurementData(state, { id, data }) {
      if (id in state.measurements) {
        Vue.set(state.measurements[id], 'data', data);
      }
    },

    deleteMeasurement(state, id) {
      if (id in state.measurements) {
        let idx = 0;

        // remove from measurements and measurementWidgets
        idx = state.measurementWidgets.indexOf(id);
        state.measurementWidgets.splice(idx, 1);
        Vue.delete(state.measurements, id);

        // remove from parents and widgetParent
        const parent = state.widgetParent[id];
        idx = state.parents[parent].indexOf(id);
        state.parents[parent].splice(idx, 1);
        Vue.delete(state.widgetParent, id);
      }
    },
  },

  actions: {
    addMeasurementData: asMutation('addMeasurementData'),
    setMeasurementData: asMutation('setMeasurementData'),
    deleteMeasurement: asMutation('deleteMeasurement'),

    // root handler
    removeData: {
      root: true,
      handler({ commit, state }, dataID) {
        if (dataID in state.parents) {
          const ids = state.parents[dataID];
          for (let i = 0; i < ids.length; i += 1) {
            commit('deleteMeasurement', ids[i]);
          }
          Vue.delete(state.parents, dataID);
        }
      },
    },
  },
});
