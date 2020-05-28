import { isVtkObject } from 'vtk.js/Sources/macro';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';

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

    setSlices(state, [x = 0, y = 0, z = 0]) {
      state.xSlice = x;
      state.ySlice = y;
      state.zSlice = z;
    },
  },

  actions: {
    /**
     * Updates the rendering pipeline.
     */
    async renderBaseImage({ dispatch, state, commit }, image) {
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

        await dispatch('resetViews');

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

    async resetViews({ dispatch }) {
      await dispatch('applySlices', [0, 0, 0]);
    },

    async applySlices({ commit, state }, slices) {
      commit('setSlices', slices);

      const { proxyManager } = dependencies;
      const source = proxyManager.getProxyById(
        state.basePipeline.transformFilterPID,
      );
      if (source) {
        proxyManager
          .getViews()
          .filter((view) => view.isA('vtkView2DProxy'))
          .forEach((view) => {
            const rep = proxyManager.getRepresentation(source, view);
            if (rep.isA('vtkSliceRepresentationProxy')) {
              const mode = rep.getSlicingMode();
              const slicingIndex = vtkImageMapper.SlicingMode[mode] % 3;
              rep.setSlice(slices[slicingIndex]);
            }
          });
      }
    },
  },
});
