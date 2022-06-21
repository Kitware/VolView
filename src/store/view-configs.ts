import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';

import { clampValue } from '@src/utils';
import { Vector3 } from '@kitware/vtk.js/types';
import { useView2DStore } from './views-2D';

export interface SliceConfig {
  slice: number;
  min: number;
  max: number;
}

export interface WindowLevelConfig {
  width: number;
  level: number;
  min: number; // data range min
  max: number; // data range max
}

export interface CameraConfig {
  parallelScale?: number;
  position?: Vector3;
  focalPoint?: Vector3;
  directionOfProjection?: Vector3;
  viewUp?: Vector3;
}

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
});

export const defaultWindowLevelConfig = (): WindowLevelConfig => ({
  width: 1,
  level: 0.5,
  min: 0,
  max: 1,
});

interface State {
  sliceConfigs: Record<string, SliceConfig>;
  wlConfigs: Record<string, WindowLevelConfig>;
  cameraConfigs: Record<string, CameraConfig>;
  // viewID -> configurations keys associate with the view
  viewConfigs: Record<string, Set<string>>;
}

const genSynViewConfigKey = (viewID: string, dataID: string) => {
  return [viewID, dataID].join('|');
};

const addViewConfigKey = (
  viewConfigs: Record<string, Set<string>>,
  viewID: string,
  key: string
) => {
  const configs = viewConfigs;
  if (!(viewID in configs)) {
    configs[viewID] = new Set<string>();
  }
  configs[viewID].add(key);
};

const setCameraConfig = (
  state: State,
  viewID: string,
  dataID: string,
  key: keyof CameraConfig,
  value: any
) => {
  const configKey = genSynViewConfigKey(viewID, dataID);

  let config: CameraConfig = {};
  if (configKey in state.cameraConfigs) {
    config = state.cameraConfigs[configKey];
  }

  config[key as keyof CameraConfig] = value;

  // New record
  if (!(configKey in state.cameraConfigs)) {
    set<CameraConfig>(state.cameraConfigs, configKey, config);
    addViewConfigKey(state.viewConfigs, viewID, configKey);
  }
};

/**
 * The data view store saves view configuration that is associated with a specific
 * view. The key is a synthetic id generated from the view ID and data ID.
 */
export const useViewConfigStore = defineStore('viewConfig', {
  state: (): State => ({
    sliceConfigs: {},
    wlConfigs: {},
    cameraConfigs: {},
    viewConfigs: {},
  }),
  getters: {
    getSliceConfig: (state) => {
      return (viewID: string, dataID: string) => {
        const key = genSynViewConfigKey(viewID, dataID);

        if (key in state.sliceConfigs) {
          return state.sliceConfigs[key];
        }

        return null;
      };
    },
    getWindowConfig: (state) => {
      return (viewID: string, dataID: string) => {
        const key = genSynViewConfigKey(viewID, dataID);

        if (key in state.wlConfigs) {
          return state.wlConfigs[key];
        }

        return null;
      };
    },
    getCameraConfig: (state) => {
      return (viewID: string, dataID: string) => {
        const key = genSynViewConfigKey(viewID, dataID);

        if (key in state.cameraConfigs) {
          return state.cameraConfigs[key];
        }

        return null;
      };
    },
  },
  actions: {
    removeViewConfig(viewID: string, dataID?: string) {
      // If we haven't been provided a dataID we will remove all view configs
      // associated with the view.
      let keys: string[];
      if (!dataID) {
        keys = [...this.viewConfigs[viewID]];
      } else {
        keys = [genSynViewConfigKey(viewID, dataID)];
      }

      keys.forEach((key: string) => {
        if (key in this.sliceConfigs && key in this.wlConfigs) {
          del(this.sliceConfigs, key);
          del(this.wlConfigs, key);
          del(this.cameraConfigs, key);

          if (viewID in this.viewConfigs) {
            this.viewConfigs[viewID].delete(key);
          }
        }
      });
    },
    setSlice(viewID: string, dataID: string, slice: number) {
      const viewStore = useView2DStore();
      const key = genSynViewConfigKey(viewID, dataID);

      if (key in this.sliceConfigs) {
        const viewsToUpdate = viewStore.syncSlices
          ? Object.keys(viewStore.orientationConfigs)
          : [viewID];

        const { axis } = viewStore.orientationConfigs[viewID];

        // sync slices across all views that share the same dataset and axis.
        // Right now, all views share the same dataset by way of primarySelection.
        viewsToUpdate.forEach((id) => {
          let config = defaultSliceConfig();
          if (viewStore.orientationConfigs[id].axis === axis) {
            // Right now all views share the same dataset, so just use dataID to
            // generate the key. This may change in the future.
            const viewConfigKey = genSynViewConfigKey(id, dataID);

            if (viewConfigKey in this.sliceConfigs) {
              config = this.sliceConfigs[viewConfigKey];
            }
            const { min, max } = config;
            config.slice = clampValue(slice, min, max);
          }
        });
      }
      // New record using the defaults
      else {
        const config = defaultSliceConfig();
        config.slice = clampValue(slice, config.min, config.max);
        set<SliceConfig>(this.sliceConfigs, key, config);
        addViewConfigKey(this.viewConfigs, viewID, key);
      }
    },
    updateSliceDomain(
      viewID: string,
      dataID: string,
      sliceDomain: [number, number]
    ) {
      const key = genSynViewConfigKey(viewID, dataID);

      let config = defaultSliceConfig();
      if (key in this.sliceConfigs) {
        config = this.sliceConfigs[key];
      }
      const [min, max] = sliceDomain;
      config.min = min;
      config.max = max;
      if (config.slice < min || config.slice > max) {
        config.slice = Math.floor((min + max) / 2);
      }

      // New record
      if (!(key in this.sliceConfigs)) {
        set<SliceConfig>(this.sliceConfigs, key, config);
        addViewConfigKey(this.viewConfigs, viewID, key);
      }
    },
    resetSlice(viewID: string, dataID: string) {
      const key = genSynViewConfigKey(viewID, dataID);

      if (key in this.sliceConfigs) {
        const config = this.sliceConfigs[key];
        this.setSlice(
          viewID,
          dataID,
          Math.floor((config.min + config.max) / 2)
        );
      }
    },
    setWindowLevel(
      viewID: string,
      dataID: string,
      wl: { width?: number; level?: number }
    ) {
      const viewStore = useView2DStore();

      const viewsToUpdate = viewStore.syncWindowing
        ? viewStore.allViewIDs
        : [viewID];

      viewsToUpdate.forEach((id: string) => {
        let config = defaultWindowLevelConfig();
        const viewConfigKey = genSynViewConfigKey(id, dataID);
        if (viewConfigKey in this.wlConfigs) {
          config = this.wlConfigs[viewConfigKey];
        }

        // don't constrain w/l to min/max
        if ('width' in wl) {
          config.width = wl.width!;
        }
        if ('level' in wl) {
          config.level = wl.level!;
        }

        // New record using the defaults
        if (!(viewConfigKey in this.wlConfigs)) {
          set<WindowLevelConfig>(this.wlConfigs, viewConfigKey, config);
          addViewConfigKey(this.viewConfigs, id, viewConfigKey);
        }
      });
    },
    updateWLDomain(viewID: string, dataID: string, wlDomain: [number, number]) {
      const key = genSynViewConfigKey(viewID, dataID);

      let config = defaultWindowLevelConfig();
      if (key in this.wlConfigs) {
        config = this.wlConfigs[key];
      }

      const [min, max] = wlDomain;
      config.min = min;
      config.max = max;

      // New record using the defaults
      if (!(key in this.wlConfigs)) {
        set<WindowLevelConfig>(this.wlConfigs, key, config);
        addViewConfigKey(this.viewConfigs, viewID, key);
      }
    },
    resetWindowLevel(viewID: string, dataID: string) {
      const key = genSynViewConfigKey(viewID, dataID);

      let config = defaultWindowLevelConfig();
      if (key in this.wlConfigs) {
        config = this.wlConfigs[key];
      }

      const width = config.max - config.min;
      const level = (config.max + config.min) / 2;
      this.setWindowLevel(viewID, dataID, { width, level });
    },
    setParallelScale(viewID: string, dataID: string, parallelScale: number) {
      const key = genSynViewConfigKey(viewID, dataID);

      let config: CameraConfig = {};
      if (key in this.cameraConfigs) {
        config = this.cameraConfigs[key];
      }

      config.parallelScale = parallelScale;

      // New record
      if (!(key in this.cameraConfigs)) {
        set<CameraConfig>(this.cameraConfigs, key, config);
        addViewConfigKey(this.viewConfigs, viewID, key);
      }
    },
    setPosition(viewID: string, dataID: string, position: Vector3) {
      setCameraConfig(this, viewID, dataID, 'position', position);
    },
    setFocalPoint(viewID: string, dataID: string, focalPoint: Vector3) {
      setCameraConfig(this, viewID, dataID, 'focalPoint', focalPoint);
    },
    setDirectionOfProjection(
      viewID: string,
      dataID: string,
      directionOfProjection: Vector3
    ) {
      setCameraConfig(
        this,
        viewID,
        dataID,
        'directionOfProjection',
        directionOfProjection
      );
    },
    setViewUp(viewID: string, dataID: string, viewUp: Vector3) {
      setCameraConfig(this, viewID, dataID, 'viewUp', viewUp);
    },
  },
});
