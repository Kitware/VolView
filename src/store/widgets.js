import { NO_WIDGET } from '@/src/constants';

export default () => ({
  state: {
    activeWidgetID: NO_WIDGET,
    widgetList: [],
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
    },
    deactivateActiveWidget(state) {
      state.activeWidgetID = NO_WIDGET;
    },
  },

  actions: {
    activateWidget({ state, commit, dispatch }, id) {
      if (state.activeWidgetID !== NO_WIDGET) {
        dispatch('deactivateActiveWidget');
      }
      commit('addAndActivateWidget', id);
    },

    deactivateActiveWidget({ state, commit }) {
      const { activeWidgetID } = state;
      if (activeWidgetID !== NO_WIDGET) {
        commit('deactivateActiveWidget');
      }
    },

    deactivateWidget({ state, commit }, id) {
      if (state.activeWidgetID === id) {
        commit('deactivateActiveWidget');
      }
    },

    async removeWidget({ commit, dispatch }, id) {
      commit('removeWidget', id);
      // delete any associated measurement data
      await dispatch('measurements/deleteMeasurement', id);
    },
  },
});
