import Vue from 'vue';
import { asMutation } from '@/src/utils/common';

export default () => ({
  namespaced: true,

  state: {
    measurementWidgets: [], // list of widget ids
    measurements: {}, // widget ID -> opaque measurement obj
  },

  mutations: {
    setMeasurementData(state, { id, type, data }) {
      if (!(id in state.measurements)) {
        state.measurementWidgets.push(id);
      }
      Vue.set(state.measurements, id, { type, data });
    },

    deleteMeasurement(state, id) {
      const idx = state.measurementWidgets.indexOf(id);
      if (idx > -1) {
        state.measurementWidgets.splice(idx, 1);
        Vue.delete(state.measurements, id);
      }
    }
  },

  actions: {
    setMeasurementData: asMutation('setMeasurementData'),
    deleteMeasurement: asMutation('deleteMeasurement'),
  }
});
