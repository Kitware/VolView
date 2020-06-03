import { isVtkObject } from 'vtk.js/Sources/macro';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';
import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';

import { addRepresentationsOf, removeRepresentationsOf, resize2DCameraToFit } from '../vtk/proxyUtils';
import { DataTypes, NO_PROXY, NO_SELECTION } from '../constants';

function defaultWorldOrientation() {
  return {
    bounds: [0, 0, 0],
    spacing: [1, 1, 1],
    // identity
    worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

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

  const pipeline = {
    dataSource,
    transformFilter,
  };

  if (data.isA('vtkPolyData')) {
    const cutterFilter = proxyManager.createProxy(
      'Sources',
      'PolyDataCutter',
      {
        inputProxy: dataSource,
      },
    );
    pipeline.transformFilter.setInputProxy(cutterFilter);
    pipeline.cutterFilter = cutterFilter;
  }

  return pipeline;
}

export default (dependencies) => ({
  namespaced: false,

  state: {
    basePipeline: {
      sourcePID: NO_PROXY,
      transformFilterPID: NO_PROXY,
    },
    worldOrientation: defaultWorldOrientation(),
    // data ID -> pipeline
    pipelines: {},
    xSlice: 0,
    ySlice: 0,
    zSlice: 0,
    resizeToFit: true,
  },

  mutations: {
    setBasePipeline(state, { sourcePID, transformFilterPID }) {
      state.basePipeline.sourcePID = sourcePID;
      state.basePipeline.transformFilterPID = transformFilterPID;
    },

    setVizPipeline(state, { dataID, pipeline }) {
      state.pipelines = {
        ...state.pipelines,
        [dataID]: { ...pipeline },
      };
    },

    setWorldOrientation(state, { bounds, spacing, worldToIndex }) {
      state.worldOrientation.bounds = [...bounds];
      state.worldOrientation.spacing = [...spacing];
      state.worldOrientation.worldToIndex = [...worldToIndex];
    },

    setSlices(state, [x = 0, y = 0, z = 0]) {
      state.xSlice = x;
      state.ySlice = y;
      state.zSlice = z;
    },

    setResizeToFit(state, yn) {
      state.resizeToFit = yn;
    },
  },

  actions: {
    async updateSceneLayers({
      dispatch, commit, state, rootState,
    }) {
      const { proxyManager } = dependencies;
      // TODO use coincident topology instead of rendering order

      const layers = [];
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        layers.push(rootState.selectedBaseImage);
      }

      layers.push(...rootState.data.labelmapIDs);
      layers.push(...rootState.data.modelIDs);

      layers.forEach(async (dataID) => {
        const dataInfo = rootState.data.index[dataID];
        if (!(dataID in rootState.data.vtkCache)) {
          switch (dataInfo.type) {
            case DataTypes.Dicom: {
              const { seriesKey } = dataInfo;
              const image = await dispatch('dicom/buildSeriesVolume', seriesKey);
              commit('cacheDicomImage', { seriesKey, image });
              break;
            }
            default:
              throw new Error(
                `updateSceneLayers: Item ${dataID} has no vtk data`,
              );
          }
        }

        if (!(dataID in state.pipelines)) {
          const vtkObj = rootState.data.vtkCache[dataID];
          const pipeline = createVizPipelineFor(vtkObj, proxyManager);
          commit('setVizPipeline', { dataID, pipeline });
        }
      });

      // Setting world orientation after processing layers ensures
      // we have a vtk image for our base image
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const image = rootState.data.vtkCache[rootState.selectedBaseImage];
        commit('setWorldOrientation', {
          bounds: image.getDimensions(),
          spacing: image.getSpacing(),
          worldToIndex: [...image.getWorldToIndex()],
        });
      } else {
        // set dimensions to be the max bounds of all layers
        const bbox = vtkBoundingBox.newInstance();
        for (let i = 0; i < layers.length; i += 1) {
          const obj = rootState.data.vtkCache[layers[i]];
          bbox.addBox(obj);
        }
        bbox.inflate(5); // some extra padding
        commit('setWorldOrientation', {
          ...defaultWorldOrientation(),
          bounds: bbox.getLengths(),
        });
      }

      // now add layer representations
      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        const { transformFilter } = state.pipelines[layer];
        transformFilter.setTransform(state.worldOrientation.worldToIndex);

        addRepresentationsOf(transformFilter, proxyManager);
      }
    },

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

        commit('setBaseMetadata', {
          ...defaultWorldOrientation(),
          bounds: image.getDimensions(),
        });

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
      await dispatch('setResizeToFit', true);
    },

    applySlices({ commit, state }, slices) {
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

    async setResizeToFit({ commit, dispatch }, yn) {
      commit('setResizeToFit', yn);
      if (yn) {
        await dispatch('resizeAllCamerasToFit');
      }
    },

    resizeAllCamerasToFit({ state }) {
      const { proxyManager } = dependencies;
      proxyManager
        .getViews()
        .filter((view) => view.isA('vtkView2DProxy'))
        .forEach((view) => {
          const { spacing } = state.worldOrientation;
          const size = state.worldOrientation
            .bounds
            .map((d, i) => (d - 1) * spacing[i])
            .filter((_, i) => i !== view.getAxis());
          resize2DCameraToFit(view, size);
          view.renderLater();
        });
    },
  },
});
