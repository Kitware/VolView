import Vue from 'vue';
import Vuex from 'vuex';

import { NO_SELECTION } from '@/src/constants';

import dicom from './dicom';
import visualization from './visualization';
import widgets from './widgets';
import annotations from './annotations';
import measurements from './measurements';
import jobs from './jobs';

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

  // data-data associations, in parent-of or child-of relationships.
  // is used for cascaded deletes
  dataAssoc: {
    childrenOf: {},
    parentOf: {},
  },
});

export default (deps) =>
  new Vuex.Store({
    modules: {
      dicom: dicom(deps),
      visualization: visualization(deps),
      widgets: widgets(deps),
      annotations: annotations(deps),
      measurements: measurements(deps),
      jobs: jobs(deps),
    },

    state: initialState(),

    getters: {
      visibleLabelmaps(state) {
        return state.data.labelmapIDs.filter(
          (id) => state.dataAssoc.parentOf[id] === state.selectedBaseImage
        );
      },
      sceneObjectIDs(state, getters) {
        const { selectedBaseImage, data } = state;
        const order = [].concat(getters.visibleLabelmaps, data.modelIDs);
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
