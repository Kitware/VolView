import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';
import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';

import {
  addRepresentationsOf, resize2DCameraToFit, removeAllRepresentations,
} from '../vtk/proxyUtils';
import { DataTypes, NO_SELECTION } from '../constants';

const defaultWorldOrientation = () => ({
  bounds: [0, 0, 0],
  spacing: [1, 1, 1],
  // identity
  worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

const defaultWindowing = () => ({
  level: 127,
  width: 255,
  min: 0,
  max: 255,
});

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
    worldOrientation: defaultWorldOrientation(),
    // data ID -> pipeline
    pipelines: {},
    xSlice: 0,
    ySlice: 0,
    zSlice: 0,
    window: defaultWindowing(),
    resizeToFit: true,
  },

  mutations: {
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

    setWindowing(state, {
      level, width, min, max,
    }) {
      const { window: w } = state;
      w.level = level ?? w.level;
      w.width = width ?? w.width;
      w.min = min ?? w.min;
      w.max = max ?? w.max;
    },

    setResizeToFit(state, yn) {
      state.resizeToFit = yn;
    },
  },

  actions: {
    async updateSceneLayers({
      dispatch, commit, state, rootState, rootGetters,
    }) {
      const { proxyManager } = dependencies;
      // TODO use coincident topology instead of rendering order
      // We don't want to remove widget representations
      removeAllRepresentations(proxyManager);

      const layers = rootGetters.layerOrder;

      await Promise.all(
        layers.map(async (dataID) => {
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
        }),
      );

      // Setting world orientation after processing layers ensures
      // we have a vtk image for our base image
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const image = rootState.data.vtkCache[rootState.selectedBaseImage];
        // vtkImageData scalars define our data. Hope we don't ever
        // have to deal with vector images here...
        const dataArray = image.getPointData().getScalars();
        const [dataMin, dataMax] = dataArray.getRange();

        commit('setWorldOrientation', {
          bounds: image.getDimensions(),
          spacing: image.getSpacing(),
          worldToIndex: [...image.getWorldToIndex()],
        });
        commit('setWindowing', {
          min: dataMin,
          max: dataMax,
          width: dataMax - dataMin,
          level: (dataMax + dataMin) / 2,
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

    async resetViews({ state, rootState, dispatch }) {
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        await dispatch('applySlices', [0, 0, 0]);
      } else {
        // pick middle of bounds
        const center = state.worldOrientation
          .bounds
          .map((b) => Math.floor(b / 2));
        await dispatch('applySlices', center);
      }
      await dispatch('setResizeToFit', true);
    },

    applySlices({ commit, state, rootGetters }, slices) {
      commit('setSlices', slices);

      // set first slice of each 2D view
      // proxy manager will propagate slice to all other slices in view
      const layers = rootGetters.layerOrder;
      if (layers.length) {
        const firstData = layers[0];
        const { transformFilter } = state.pipelines[firstData];
        if (transformFilter) {
          const { proxyManager } = dependencies;
          proxyManager
            .getViews()
            .filter((view) => view.isA('vtkView2DProxy'))
            .forEach((view) => {
              const rep = proxyManager.getRepresentation(transformFilter, view);
              if (rep.getSlicingMode && rep.setSlice) {
                const mode = rep.getSlicingMode();
                const slicingIndex = vtkImageMapper.SlicingMode[mode] % 3;
                rep.setSlice(slices[slicingIndex]);
              }
            });
        }
      }
    },

    async setResizeToFit({ commit, dispatch }, yn) {
      commit('setResizeToFit', yn);
      if (yn) {
        await dispatch('resizeAllCamerasToFit');
      }
    },

    setWindowing({ state, commit, rootState }, params) {
      commit('setWindowing', params);

      // only set windowing on base image
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const { transformFilter } = state.pipelines[rootState.selectedBaseImage];
        if (transformFilter) {
          const { proxyManager } = dependencies;
          const view2D = proxyManager.getViews().find((v) => v.isA('vtkView2DProxy'));
          if (view2D) {
            const rep = proxyManager.getRepresentation(transformFilter, view2D);
            if (rep.setWindowWidth) {
              rep.setWindowWidth(state.window.width);
            }
            if (rep.setWindowLevel) {
              rep.setWindowLevel(state.window.level);
            }
          }
        }
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

    // ===================
    // ProxyManager events
    // ===================

    pxmProxyModified: {
      root: true,
      handler({ commit }, proxy) {
        if (proxy.getWindowLevel && proxy.getWindowWidth) {
          // ProxyManager will handle syncing windowing params to
          // other proxies, so only record the current value here.
          const level = proxy.getWindowLevel();
          const width = proxy.getWindowWidth();
          commit('setWindowing', { level, width });
        }
      },
    },
  },
});
