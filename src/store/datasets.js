export default ({ loader }) => ({
  namespaced: true,

  state: {
    errors: {},
  },

  mutations: {
    setError(state, { name, error }) {
      state.errors = {
        ...state.errors,
        [name]: error,
      };
    },
  },

  actions: {

    /**
     * Loads a list of files into the application.
     *
     * Returns an object that maps file names to error objects.
     * If no errors are encountered, then the object is empty.
     * @param {[]File} files
     */
    async loadFiles({ commit, dispatch }, files) {
      const results = await Promise.allSettled(files.map((file) => dispatch('loadSingleFile', file)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const fileName = files[index].name;
          commit('setError', fileName, result.reason);
        }
      });
    },

    /**
     * Loads a single file
     *
     * Returns an object: {}
     * @param {*} file
     */
    async loadSingleFile(_, file) {
      await loader.parseFile(file);
    },
  },
});
