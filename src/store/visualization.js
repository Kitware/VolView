import { isVtkObject } from 'vtk.js/Sources/macro';

import { NO_PROXY } from '@/src/constants';
import { addRepresentationsOf, removeRepresentationsOf } from '../vtk/proxyUtils';

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
    xSlice: 0,
    ySlice: 0,
    zSlice: 0,
  },

  mutations: {
    setBasePipeline(state, { sourcePID, transformFilterPID }) {
      state.basePipeline.sourcePID = sourcePID;
      state.basePipeline.transformFilterPID = transformFilterPID;
    },

    resetSlices(state) {
      state.xSlice = 0;
      state.ySlice = 0;
      state.zSlice = 0;
    },
  },

  actions: {
    /**
     * Updates the rendering pipeline.
     */
    renderBaseImage({ state, commit }, image) {
      const { proxyManager } = dependencies;

      if (isVtkObject(image) && image.isA('vtkImageData')) {
        if (state.basePipeline.sourcePID === NO_PROXY) {
          const { dataSource, transformFilter } = createVizPipelineFor(
            image,
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

        source.setInputData(image);
        transformFilter.setTransform(image.getWorldToIndex());
        addRepresentationsOf(transformFilter, proxyManager);

        // TODO update all other layers

        proxyManager.renderAllViews();
      }
    },

    renderEmptyBase({ state }) {
      if (state.basePipeline.sourcePID !== NO_PROXY) {
        const { proxyManager } = dependencies;
        // detach representations
        const { transformFilterPID } = state.basePipeline;
        const transformFilter = proxyManager.getProxyById(transformFilterPID);
        removeRepresentationsOf(transformFilter, proxyManager);
      }
    },
  },
});
