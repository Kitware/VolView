import Vue from 'vue';
import Vuex from 'vuex';

import datasetsModule from './datasets';

Vue.use(Vuex);

const modules = (deps) => ({
  datasets: datasetsModule(deps),
});

export default (deps) => new Vuex.Store({
  state: {
  },
  mutations: {
  },
  actions: {
  },
  modules: modules(deps),
});
