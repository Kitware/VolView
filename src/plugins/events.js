/**
 * This should only be used for signalling between unrelated components.
 * Data and state should NOT be passed around.
 */
export default {
  install(Vue) {
    /* eslint-disable-next-line no-param-reassign */
    Vue.prototype.$eventBus = new Vue();
  },
};
