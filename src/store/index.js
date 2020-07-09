import Vue from 'vue';
import Vuex from 'vuex';

import { NO_SELECTION } from '@/src/constants';

import dicom from './dicom';
import visualization from './visualization';
import annotations from './annotations';

import * as datasets from './datasets';

Vue.use(Vuex);

export const initialState = () => ({
  data: {
    nextID: 1,
    index: {},
    imageIDs: [],
    dicomIDs: [],
    modelIDs: [],
    labelmapIDs: [],
    vtkCache: {},
  },

  // track the mapping from seriesUID to data ID
  dicomSeriesToID: {},
  selectedBaseImage: NO_SELECTION,
});

export default (deps) => new Vuex.Store({
  modules: {
    dicom: dicom(deps),
    visualization: visualization(deps),
    annotations: annotations(deps),
  },

  state: initialState(),

  getters: {
    sceneObjectIDs(state) {
      const { selectedBaseImage, data } = state;
      const order = [].concat(data.labelmapIDs, data.modelIDs);
      if (selectedBaseImage !== NO_SELECTION) {
        order.unshift(selectedBaseImage);
      }
      return order;
    },
  },

  mutations: {
    ...datasets.mutations,
  },

  actions: {
    ...datasets.makeActions(deps),
  },
});
