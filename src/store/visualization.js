import { NO_PROXY, NO_SELECTION } from '@/src/constants';
import { renderRepresentationsOf, removeRepresentationsOf } from '../vtk/proxyUtils';

function createVizPipelineFor(data, proxyManager) {
  let transformType = null;
  if (data.isA('vtkImageData')) {
    transformType = 'ImageTransform';
  } else if (data.isA('vtkPolyData')) {
    transformType = 'PolyDataTransform';
  } else {
    throw new Error('createVizPipelineFor: data is not image or geometry');
  }

  const dataSource = proxyManager.createProxy(
    'Sources',
    'TrivialProducer',
  );
  dataSource.setInputData(data);

  const transformFilter = proxyManager.createProxy(
    'Sources',
    transformType,
    {
      inputProxy: dataSource,
    },
  );

  return {
    dataSource,
    transformFilter,
  };
}

export default (dependencies) => ({
  namespaced: false,

  state: {
    basePipeline: {
      sourcePID: NO_PROXY,
      transformFilterPID: NO_PROXY,
    },
    pipelines: {},
  },

  getters: {
    datasets(state, getters, rootState) {
      return rootState.datasets;
    },
  },

  mutations: {
    setBasePipeline(state, { sourcePID, transformFilterPID }) {
      state.basePipeline.sourcePID = sourcePID;
      state.basePipeline.transformFilterPID = transformFilterPID;
    },
  },

  actions: {
    /**
     * Updates the rendering pipeline.
     *
     * Assumes the selected base image has cached vtk data.
     */
    async updateRenderPipeline({ getters, state, commit }) {
      const { proxyManager } = dependencies;

      const baseID = getters.datasets.selectedBaseImage;
      if (baseID !== NO_SELECTION) {
        const imageData = getters.datasets.data.vtkCache[baseID];

        if (state.basePipeline.sourcePID === NO_PROXY) {
          const { dataSource, transformFilter } = createVizPipelineFor(
            imageData,
            proxyManager,
          );
          commit('setBasePipeline', {
            sourcePID: dataSource.getProxyId(),
            transformFilterPID: transformFilter.getProxyId(),
          });
        }

        const { sourcePID, transformFilterPID } = state.basePipeline;
        const source = proxyManager.getProxyById(sourcePID);
        const transformFilter = proxyManager.getProxyById(transformFilterPID);

        source.setInputData(imageData);
        transformFilter.setTransform(
          getters.datasets.baseMetadata.worldToIndex,
        );
        renderRepresentationsOf(transformFilter, proxyManager);

        // TODO update all other layers

        proxyManager.renderAllViews();
      } else if (state.basePipeline.sourcePID !== NO_PROXY) {
        // detach representations
        const { transformFilterPID } = state.basePipeline;
        const transformFilter = proxyManager.getProxyById(transformFilterPID);
        removeRepresentationsOf(transformFilter, proxyManager);
      }
    },
  },
});
