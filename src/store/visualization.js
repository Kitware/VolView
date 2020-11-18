import Vue from 'vue';
import vtkBoundingBox from 'vtk.js/Sources/Common/DataModel/BoundingBox';
import LUTConstants from 'vtk.js/Sources/Proxy/Core/LookupTableProxy/Constants';

import { NO_SELECTION } from '../constants';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

const { Mode } = LUTConstants;

export function asInteger(value, defaultValue) {
  const rv = Math.round(value);
  if (Number.isInteger(rv)) {
    return rv;
  }
  return defaultValue;
}

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

// slicing is done in index space
export const defaultSlicing = () => ({
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
    worldOrientation: defaultWorldOrientation(),
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

    setWorldOrientation(state, { bounds, spacing, direction, worldToIndex }) {
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
    boundsWithSpacing(state) {
      const { spacing, bounds } = state.worldOrientation;
      return bounds.map((b, i) => b * spacing[Math.floor(i / 2)]);
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
        await dispatch('updateWorldOrientation');
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
     * Should run after updateWorldOrientation
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
            if (rep.setTransform) {
              rep.setTransform(...state.worldOrientation.worldToIndex);
            }
            rep.getMapper().modified();
          }
        });
      }
    },
  },
});
