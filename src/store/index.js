import Vue from 'vue';
import Vuex from 'vuex';

import datasetsModule from './datasets';

Vue.use(Vuex);

const modules = (services) => ({
  datasets: datasetsModule(services),
});

export default (services) => new Vuex.Store({
  state: {
  },
  mutations: {
  },
  actions: {
  },
  modules: modules(services),
});
