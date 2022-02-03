import Vue from 'vue';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import LUTConstants from '@kitware/vtk.js/Proxy/Core/LookupTableProxy/Constants';

import { NO_SELECTION } from '../constants';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

const { Mode } = LUTConstants;

export const CoordinateSystem = {
  Image: 'image',
  World: 'world',
};

export function asInteger(value, defaultValue) {
  const rv = Math.round(value);
  if (Number.isInteger(rv)) {
    return rv;
  }
  return defaultValue;
}

export const defaultImageParams = () => ({
  bounds: [0, 1, 0, 1, 0, 1],
  extent: [0, 1, 0, 1, 0, 1],
  dimensions: [1, 1, 1],
  spacing: [1, 1, 1],
  // all matrices are column-major
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  worldToIndex: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  indexToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});

export const defaultWindowing = () => ({
  level: 127,
  width: 255,
  min: 0,
  max: 255,
});

// For image, XYZ corresponds to image IJK
// For world, XYZ corresponds to LPS in vtk.js
export const defaultSlicing = () => ({
  system: CoordinateSystem.Image,
  x: 0,
  y: 0,
  z: 0,
});

/**
 * First step must be a dataset. Intermediate steps must be filters.
 */
export function createVizPipeline(steps, proxyManager) {
  const pipeline = {};

  steps.forEach((step, i) => {
    if (i === 0 && step.type === 'dataset') {
      const source = proxyManager.createProxy('Sources', 'TrivialProducer');
      source.setInputData(step.dataset);

      pipeline[i] = source;
      pipeline.source = source;
    } else if (i > 0 && step.type === 'filter') {
      const { id, proxyGroup, proxyName } = step;
      const filter = proxyManager.createProxy(proxyGroup, proxyName, {
        inputProxy: pipeline[i - 1],
      });

      pipeline[i] = filter;
      pipeline[id] = filter;
    }
  });

  pipeline.length = steps.length;
  // eslint-disable-next-line prefer-destructuring
  pipeline.first = pipeline[0];
  pipeline.last = pipeline[pipeline.length - 1];
  return pipeline;
}

export default (dependencies) => ({
  namespaced: true,

  state: {
    // data ID -> pipeline
    pipelines: {},
    slices: defaultSlicing(),
    resizeToFit: true,
    imageParams: defaultImageParams(),
    windowing: defaultWindowing(),
    colorBy: {}, // id -> { array, location }
    arrayLutPresets: {}, // arrayName -> LUT preset
    solidColors: {}, // id -> rgb array
  },

  mutations: {
    setVizPipeline(state, { dataID, pipeline }) {
      state.pipelines = {
        ...state.pipelines,
        [dataID]: { ...pipeline },
      };
    },

    setImageParams(
      state,
      { bounds, extent, spacing, direction, worldToIndex, indexToWorld }
    ) {
      state.imageParams = {
        bounds: [...bounds],
        extent: [...extent],
        dimensions: [
          extent[1] - extent[0] + 1,
          extent[3] - extent[2] + 1,
          extent[5] - extent[4] + 1,
        ],
        spacing: [...spacing],
        direction: [...direction],
        worldToIndex: [...worldToIndex],
        indexToWorld: [...indexToWorld],
      };
    },

    setSlices(state, { x, y, z }) {
      const { slices: s } = state;
      state.slices = {
        system: s.system,
        x: asInteger(x, s.x),
        y: asInteger(y, s.y),
        z: asInteger(z, s.z),
      };
    },

    setWindowing(state, { level, width, min, max }) {
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

    setArrayColorPreset(state, { array, presetName }) {
      if (array && presetName) {
        Vue.set(state.arrayLutPresets, array, presetName);
      }
    },

    setSolidColor(state, { dataID, rgb }) {
      if (dataID !== NO_SELECTION && Array.isArray(rgb) && rgb.length === 3) {
        Vue.set(state.solidColors, dataID, rgb);
      }
    },

    setColorBy(state, { id, array = '', location = '' }) {
      if (id !== NO_SELECTION) {
        // Modify entire obj so that VtkView colorBy watcher triggers
        state.colorBy = {
          ...state.colorBy,
          [id]: { array, location },
        };
      }
    },

    setResizeToFit(state, yn) {
      state.resizeToFit = yn;
    },

    removeModel(state, dataID) {
      Vue.delete(state.models.colorBy, dataID);
    },

    removeData(state, dataID) {
      Vue.delete(state.pipelines, dataID);
      Vue.delete(state.colorBy, dataID);
      Vue.delete(state.solidColors, dataID);
    },
  },

  getters: {
    extentWithSpacing(state) {
      const { spacing, extent } = state.imageParams;
      return extent.map((b, i) => b * spacing[Math.floor(i / 2)]);
    },
    baseImagePipeline(state, getters, rootState) {
      const { selectedBaseImage } = rootState;
      return selectedBaseImage !== NO_SELECTION
        ? state.pipelines[selectedBaseImage]
        : null;
    },
    baseImageColorPreset(state, getters, rootState) {
      const { colorBy } = state;
      const { selectedBaseImage } = rootState;
      const { array } = colorBy[selectedBaseImage] || {};
      return state.arrayLutPresets[array] || DEFAULT_PRESET;
    },
  },

  actions: {
    async updateScene({ dispatch }, { reset = false }) {
      if (reset) {
        await dispatch('updateImageParams');
        await dispatch('resetWindowing');
        await dispatch('resetSlicing');
        await dispatch('updateColorBy');
        await dispatch('setResizeToFit', true);
      }

      await dispatch('createPipelinesForScene');

      // these actions depend on pipelines and colorby info
      if (reset) {
        await dispatch('setBaseImageColorPreset', DEFAULT_PRESET);
      }
    },

    /**
     * Should run after updateImageParams
     */
    createPipelinesForScene({ commit, state, rootGetters, rootState }) {
      const { proxyManager } = dependencies;
      const { sceneObjectIDs } = rootGetters;
      for (let i = 0; i < sceneObjectIDs.length; i += 1) {
        const dataID = sceneObjectIDs[i];
        if (!(dataID in state.pipelines)) {
          const vtkObj = rootState.data.vtkCache[dataID];
          const pipeline = createVizPipeline(
            [{ type: 'dataset', dataset: vtkObj }],
            proxyManager
          );
          commit('setVizPipeline', { dataID, pipeline });
        }
      }
    },

    async updateImageParams({ commit, rootState }) {
      const { selectedBaseImage, data } = rootState;
      if (selectedBaseImage !== NO_SELECTION) {
        const image = data.vtkCache[selectedBaseImage];
        commit('setImageParams', {
          bounds: image.getBounds(),
          extent: image.getExtent(),
          spacing: image.getSpacing(),
          direction: image.getDirection(),
          worldToIndex: [...image.getWorldToIndex()],
          indexToWorld: [...image.getIndexToWorld()],
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
        commit('setImageParams', {
          ...defaultImageParams(),
          bounds: bbox.getBounds(),
          extent: bbox.getBounds(),
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
     * updateImageParams should be invoked prior to this action.
     */
    async resetSlicing({ commit, state }) {
      // pick middle of extent
      const { extent } = state.imageParams;
      const center = [
        Math.round((extent[0] + extent[1]) / 2),
        Math.round((extent[2] + extent[3]) / 2),
        Math.round((extent[4] + extent[5]) / 2),
      ];
      await commit('setSlices', {
        x: center[0],
        y: center[1],
        z: center[2],
      });
    },

    updateColorBy({ commit, rootState }) {
      const { selectedBaseImage, data } = rootState;
      if (selectedBaseImage !== NO_SELECTION) {
        const image = data.vtkCache[selectedBaseImage];
        const scalars = image.getPointData().getScalars();
        commit('setColorBy', {
          id: selectedBaseImage,
          array: scalars.getName(),
          location: 'pointData',
        });
      } else {
        commit('setColorBy', {
          id: selectedBaseImage,
          array: '',
          location: '',
        });
      }
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

    setBaseImageColorPreset({ commit, state, rootState }, presetName) {
      const { selectedBaseImage } = rootState;
      if (selectedBaseImage !== NO_SELECTION) {
        const { array } = state.colorBy[selectedBaseImage] || {};
        if (array) {
          const { proxyManager } = dependencies;
          const lut = proxyManager.getLookupTable(array);
          lut.setMode(Mode.Preset);
          lut.setPresetName(presetName);
          commit('setArrayColorPreset', { array, presetName });
        }
      }
    },

    setModelColorBy(
      { dispatch, commit, state },
      { id, colorBy: { array, location } }
    ) {
      if (id !== NO_SELECTION) {
        commit('setColorBy', { id, array, location });
        dispatch('setModelColorPreset', {
          id,
          presetName: state.arrayLutPresets[array] || DEFAULT_PRESET,
        });
      }
    },

    setModelColorPreset({ commit, state, rootState }, { id, presetName }) {
      if (id !== NO_SELECTION && presetName) {
        const { data } = rootState;
        const { array, location } = state.colorBy[id] || {};
        if (array && location) {
          const { proxyManager } = dependencies;
          const attrs = data.vtkCache[id].getReferenceByName(location);
          if (attrs && attrs.hasArray(array)) {
            const lut = proxyManager.getLookupTable(array);
            lut.setMode(Mode.Preset);
            lut.setPresetName(presetName);
            lut.setDataRange(...attrs.getArray(array).getRange());
            commit('setArrayColorPreset', { array, presetName });
          }
        }
      }
    },

    removeData({ commit, state }, dataID) {
      const pipeline = state.pipelines[dataID];
      if (pipeline) {
        const { proxyManager } = dependencies;
        for (let i = pipeline.length - 1; i >= 0; i -= 1) {
          proxyManager.deleteProxy(pipeline[i]);
        }
      }
      commit('removeData', dataID);
    },

    redrawPipeline({ state }, dataID) {
      if (dataID in state.pipelines) {
        const { proxyManager } = dependencies;
        const { last: source } = state.pipelines[dataID];
        proxyManager.getViews().forEach((view) => {
          const rep = proxyManager.getRepresentation(source, view);
          if (rep) {
            rep.getMapper().modified();
          }
        });
      }
    },
  },
});
