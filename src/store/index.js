import Vue from 'vue';
import Vuex from 'vuex';

import { NO_SELECTION } from '@/src/constants';

import dicom from './dicom';
import visualization from './visualization';

import * as datasets from './datasets';

Vue.use(Vuex);

export const initialState = () => ({
  data: {
    nextID: 1,
    index: {},
    imageIDs: [],
    dicomIDs: [],
    vtkCache: {},
  },

  // track the mapping from seriesUID to data ID
  dicomSeriesToID: {},

  selectedBaseImage: NO_SELECTION,
  baseMetadata: {
    spacing: [1, 1, 1],
    // identity
    worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  },
});

export default (deps) => new Vuex.Store({
  modules: {
    dicom: dicom(deps),
    visualization: visualization(deps),
  },

  state: initialState(),

  mutations: {
    ...datasets.mutations,
  },

  actions: {
    ...datasets.makeActions(deps),
  },
});
