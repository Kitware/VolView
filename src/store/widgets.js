import Vue from 'vue';

import { asMutation } from '@/src/utils/common';
import { NO_WIDGET } from '@/src/constants';

export default () => ({
  state: {
    activeWidgetID: NO_WIDGET,
    widgetList: [],
    removeWidgetOnDeactivate: {}, // widget ID -> boolean
  },

  mutations: {
    addAndActivateWidget(state, id) {
      state.widgetList.push(id);
      state.activeWidgetID = id;
    },
    removeWidget(state, widgetID) {
      const idx = state.widgetList.indexOf(widgetID);
      if (idx > -1) {
        state.widgetList.splice(idx, 1);
      }
      Vue.delete(state.removeWidgetOnDeactivate, widgetID);
    },
    deactivateActiveWidget(state) {
      state.activeWidgetID = NO_WIDGET;
    },
    setRemoveWidgetOnDeactivate(state, { widgetID, remove }) {
      Vue.set(state.removeWidgetOnDeactivate, widgetID, remove);
    },
  },

  actions: {
    activateWidget({ state, commit, dispatch }, id) {
      if (state.activeWidgetID !== NO_WIDGET) {
        dispatch('deactivateActiveWidget');
      }
      commit('addAndActivateWidget', id);
    },

    async deactivateActiveWidget({ state, dispatch }) {
      dispatch('deactivateWidget', state.activeWidgetID);
    },

    deactivateWidget({ state, commit }, id) {
      const { activeWidgetID, removeWidgetOnDeactivate } = state;
      if (activeWidgetID !== NO_WIDGET && activeWidgetID === id) {
        if (removeWidgetOnDeactivate[id]) {
          commit('removeWidget', id);
        }
        commit('deactivateActiveWidget');
      }
    },

    setRemoveWidgetOnDeactivate: asMutation('setRemoveWidgetOnDeactivate'),

    async removeWidget({ commit, dispatch }, id) {
      commit('removeWidget', id);
      // delete any associated measurement data
      await dispatch('measurements/deleteMeasurement', id);
    },

    async removeData({ state, dispatch }, dataID) {
      if (state.selectedBaseImage === dataID) {
        await dispatch('deactivateActiveWidget');
      }
    },
  },
});
