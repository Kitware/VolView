import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';

import { addRepresentationsOf, resize2DCameraToFit } from '../vtk/proxyUtils';
import { DataTypes, NO_SELECTION } from '../constants';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

export const defaultWorldOrientation = () => ({
  // ok for images this is actually just extent, since
  // that's how we process images in this application.
  bounds: [0, 1, 0, 1, 0, 1],
  // world spacing
  spacing: [1, 1, 1],
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  // identity
  worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

export const defaultWindowing = () => ({
  level: 127,
  width: 255,
  min: 0,
  max: 255,
});

export const defaultSlicing = () => ({
  x: 0,
  y: 0,
  z: 0,
});

export function createVizPipelineFor(data, proxyManager) {
  let transformType = null;
  if (data.getClassName() === 'vtkImageData') {
    transformType = 'ImageTransform';
  } else if (data.getClassName() === 'vtkPolyData') {
    transformType = 'PolyDataTransform';
  } else if (data.getClassName() === 'vtkLabelMap') {
    transformType = 'LabelMapTransform';
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
    // data ID -> pipeline
    pipelines: {},
    slices: defaultSlicing(),
    resizeToFit: true,

    worldOrientation: defaultWorldOrientation(),
    windowing: defaultWindowing(),

    baseImageColorPreset: DEFAULT_PRESET,
  },

  mutations: {
    setVizPipeline(state, { dataID, pipeline }) {
      state.pipelines = {
        ...state.pipelines,
        [dataID]: { ...pipeline },
      };
    },

    setWorldOrientation(state, {
      bounds, spacing, direction, worldToIndex,
    }) {
      state.worldOrientation = {
        bounds: [...bounds],
        spacing: [...spacing],
        direction: [...direction],
        worldToIndex: [...worldToIndex],
      };
    },

    setSlices(state, { x, y, z }) {
      const { slices: s } = state;
      state.slices = {
        x: x ?? s.x,
        y: y ?? s.y,
        z: z ?? s.z,
      };
    },

    setWindowing(state, {
      level, width, min, max,
    }) {
      const { windowing: w } = state;
      state.windowing = {
        level: level ?? w.level,
        width: width ?? w.width,
        min: min ?? w.min,
        max: max ?? w.max,
      };
    },

    setBaseImageColorPreset(state, presetName) {
      state.baseImageColorPreset = presetName;
    },

    setResizeToFit(state, yn) {
      state.resizeToFit = yn;
    },
  },

  getters: {
    boundsWithSpacing: (state) => {
      const { spacing, bounds } = state.worldOrientation;
      return bounds.map((b, i) => b * spacing[Math.floor(i / 2)]);
    },
    baseImagePipeline: (state, getters, rootState) => {
      const { selectedBaseImage } = rootState;
      return selectedBaseImage !== NO_SELECTION
        ? state.pipelines[selectedBaseImage]
        : null;
    },
  },

  actions: {
    async updateScene({ dispatch }, { reset = false }) {
      if (reset) {
        await dispatch('updateWorldOrientation');
        await dispatch('resetWindowing');
        await dispatch('resetSlicing');
        await dispatch('setBaseImageColorPreset', DEFAULT_PRESET);
        await dispatch('setResizeToFit', true);
      }
      await dispatch('createPipelinesForScene');
    },

    /**
     * Should run after updateWorldOrientation
     */
    createPipelinesForScene({
      commit, state, rootGetters, rootState,
    }) {
      const { proxyManager } = dependencies;
      const { sceneObjectIDs } = rootGetters;
      for (let i = 0; i < sceneObjectIDs.length; i += 1) {
        const dataID = sceneObjectIDs[i];
        if (!(dataID in state.pipelines)) {
          const vtkObj = rootState.data.vtkCache[dataID];
          const pipeline = createVizPipelineFor(vtkObj, proxyManager);
          commit('setVizPipeline', { dataID, pipeline });
        }
        const { transformFilter } = state.pipelines[dataID];
        transformFilter.setTransform(state.worldOrientation.worldToIndex);
      }
    },

    async updateWorldOrientation({ commit, rootState }) {
      const { selectedBaseImage, data } = rootState;
      if (selectedBaseImage !== NO_SELECTION) {
        const image = data.vtkCache[selectedBaseImage];
        const spacing = image.getSpacing();
        commit('setWorldOrientation', {
          bounds: image.getExtent(),
          spacing,
          direction: image.getDirection(),
          worldToIndex: [...image.getWorldToIndex()],
        });
      } else {
      // set dimensions to be the max bounds of all layers
        const layers = [].concat(data.labelmapIDs, data.modelIDs);
        const bbox = vtkBoundingBox.newInstance();
        for (let i = 0; i < layers.length; i += 1) {
          const obj = data.vtkCache[layers[i]];
          bbox.addBox(obj);
        }
        bbox.inflate(5); // some extra padding
        // Without a base image, we assume a spacing of 1.
        commit('setWorldOrientation', {
          ...defaultWorldOrientation(),
          bounds: bbox.getBounds(),
        });
      }
    },

    resetWindowing({ commit, rootState }) {
      const { selectedBaseImage, data } = rootState;
      if (selectedBaseImage !== NO_SELECTION) {
        const image = data.vtkCache[selectedBaseImage];
        const dataArray = image.getPointData().getScalars();
        const [dataMin, dataMax] = dataArray.getRange();
        commit('setWindowing', {
          min: dataMin,
          max: dataMax,
          width: dataMax - dataMin,
          level: (dataMax + dataMin) / 2,
        });
      } else {
        commit('setWindowing', defaultWindowing());
      }
    },

    /**
     * updateWorldOrientation should be invoked prior to this action.
     */
    async resetSlicing({ commit, state, rootState }) {
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const { bounds } = state.worldOrientation;
        await commit('setSlices', {
          x: bounds[0],
          y: bounds[2],
          z: bounds[4],
        });
      } else {
        // pick middle of bounds
        const { bounds } = state.worldOrientation;
        const center = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2,
        ];
        await commit('setSlices', {
          x: center[0],
          y: center[1],
          z: center[2],
        });
      }
    },

    async updateSceneLayers({
      dispatch, commit, state, rootState, rootGetters,
    }) {
      const { proxyManager } = dependencies;

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

        const spacing = image.getSpacing();
        commit('setWorldOrientation', {
          bounds: image.getExtent(),
          spacing,
          direction: image.getDirection(),
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
        // Without a base image, we assume a spacing of 1.
        commit('setWorldOrientation', {
          ...defaultWorldOrientation(),
          bounds: bbox.getBounds(),
        });
        commit('setWindowing', defaultWindowing());
      }

      // now add layer representations
      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i];
        const { transformFilter } = state.pipelines[layer];
        transformFilter.setTransform(state.worldOrientation.worldToIndex);

        addRepresentationsOf(transformFilter, proxyManager);
      }
    },

    async resetViews({
      state, rootState, getters, dispatch,
    }) {
      if (rootState.selectedBaseImage !== NO_SELECTION) {
        const { bounds } = state.worldOrientation;
        await dispatch('setSlices', {
          x: bounds[0],
          y: bounds[2],
          z: bounds[4],
        });
      } else {
        // pick middle of bounds
        const { bounds } = state.worldOrientation;
        const center = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2,
        ];
        await dispatch('setSlices', {
          x: center[0],
          y: center[1],
          z: center[2],
        });
      }

      const { proxyManager } = dependencies;

      proxyManager
        .getViews()
        .forEach((view) => {
          if (view.isA('vtkView2DProxy')) {
            const renderer = view.getRenderer();
            renderer.computeVisiblePropBounds();
            renderer.resetCamera(getters.worldBounds);
          } else {
            // 3D views
            view.resetCamera();
          }
        });

      await dispatch('setResizeToFit', true);
    },

    // TODO asMutation
    setSlices({ commit }, slices) {
      commit('setSlices', slices);
    },

    // TODO asMutation
    setResizeToFit({ commit }, yn) {
      commit('setResizeToFit', yn);
    },

    // TODO asMutation
    setWindowing({ commit }, params) {
      commit('setWindowing', params);
    },

    setBaseImageColorPreset({ commit }, presetName) {
      commit('setBaseImageColorPreset', presetName);
    },

    resizeAllCamerasToFit({ getters }) {
      const { proxyManager } = dependencies;
      proxyManager
        .getViews()
        .filter((view) => view.isA('vtkView2DProxy'))
        .forEach((view) => {
          resize2DCameraToFit(view, getters.worldBounds);
        });
    },
  },
});
