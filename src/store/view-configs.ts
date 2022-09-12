import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';

import { clampValue } from '@src/utils';
import { Vector3 } from '@kitware/vtk.js/types';
import { ColorTransferFunction, OpacityFunction } from './views-3D';
import { LPSAxisDir } from '../types/lps';

export interface SliceConfig {
  slice: number;
  min: number;
  max: number;
  axisDirection: LPSAxisDir;
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

export interface VolumeColorConfig {
  colorBy: {
    arrayName: string;
    location: string;
  };
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
}

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
  axisDirection: 'Inferior',
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
  volumeColorConfigs: Record<string, VolumeColorConfig>;
  // viewID -> configurations keys associate with the view
  viewConfigs: Record<string, Set<string>>;
}

const genSynViewConfigKey = (viewID: string, dataID: string) => {
  return [viewID, dataID].join('|');
};

const configGetter =
  <T>(config: Record<string, T>) =>
  (viewID: string, dataID: string) => {
    const key = genSynViewConfigKey(viewID, dataID);

    if (key in config) {
      return config[key];
    }

    return null;
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
    volumeColorConfigs: {},
    viewConfigs: {},
  }),
  getters: {
    getSliceConfig: (state) => configGetter(state.sliceConfigs),
    getWindowConfig: (state) => configGetter(state.wlConfigs),
    getCameraConfig: (state) => configGetter(state.cameraConfigs),
    getVolumeColorConfig: (state) => configGetter(state.volumeColorConfigs),
  },
  actions: {
    addViewConfigKey(viewID: string, key: string) {
      if (!(viewID in this.viewConfigs)) {
        this.viewConfigs[viewID] = new Set<string>();
      }
      this.viewConfigs[viewID].add(key);
    },
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
          del(this.volumeColorConfigs, key);

          if (viewID in this.viewConfigs) {
            this.viewConfigs[viewID].delete(key);
          }
        }
      });
    },
    updateSliceConfig(
      viewID: string,
      dataID: string,
      update: Partial<SliceConfig>
    ) {
      const key = genSynViewConfigKey(viewID, dataID);
      const config = {
        ...defaultSliceConfig(),
        ...this.sliceConfigs[key],
        ...update,
      };

      if ('min' in update || 'max' in update) {
        config.slice = Math.floor((config.min + config.max) / 2);
      }
      config.slice = clampValue(config.slice, config.min, config.max);

      set(this.sliceConfigs, key, config);
      this.addViewConfigKey(viewID, key);
    },
    resetSlice(viewID: string, dataID: string) {
      const key = genSynViewConfigKey(viewID, dataID);

      if (key in this.sliceConfigs) {
        const config = this.sliceConfigs[key];
        // Make this consistent with ImageMapper + SliceRepresentationProxy
        // behavior. Setting this to floor() will affect images where the
        // middle slice is fractional.
        this.updateSliceConfig(viewID, dataID, {
          slice: Math.ceil((config.min + config.max) / 2),
        });
      }
    },
    setWindowLevel(
      viewID: string,
      dataID: string,
      wl: { width?: number; level?: number }
    ) {
      // TODO sync window level
      const viewConfigKey = genSynViewConfigKey(viewID, dataID);
      if (viewConfigKey in this.wlConfigs) {
        const config = this.wlConfigs[viewConfigKey];

        // don't constrain w/l to min/max
        if ('width' in wl) {
          config.width = wl.width!;
        }
        if ('level' in wl) {
          config.level = wl.level!;
        }
      }
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
        this.addViewConfigKey(viewID, key);
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
        this.addViewConfigKey(viewID, key);
      }
    },
    _setCameraConfig(
      viewID: string,
      dataID: string,
      key: keyof CameraConfig,
      value: any
    ) {
      const configKey = genSynViewConfigKey(viewID, dataID);

      let config: CameraConfig = {};
      if (configKey in this.cameraConfigs) {
        config = this.cameraConfigs[configKey];
      }

      config[key as keyof CameraConfig] = value;

      // New record
      if (!(configKey in this.cameraConfigs)) {
        set<CameraConfig>(this.cameraConfigs, configKey, config);
        this.addViewConfigKey(viewID, configKey);
      }
    },

    setPosition(viewID: string, dataID: string, position: Vector3) {
      this._setCameraConfig(viewID, dataID, 'position', position);
    },
    setFocalPoint(viewID: string, dataID: string, focalPoint: Vector3) {
      this._setCameraConfig(viewID, dataID, 'focalPoint', focalPoint);
    },
    setDirectionOfProjection(
      viewID: string,
      dataID: string,
      directionOfProjection: Vector3
    ) {
      this._setCameraConfig(
        viewID,
        dataID,
        'directionOfProjection',
        directionOfProjection
      );
    },
    setViewUp(viewID: string, dataID: string, viewUp: Vector3) {
      this._setCameraConfig(viewID, dataID, 'viewUp', viewUp);
    },
    setVolumeColoring(
      viewID: string,
      dataID: string,
      config: VolumeColorConfig
    ) {
      const key = genSynViewConfigKey(viewID, dataID);
      set(this.volumeColorConfigs, key, config);
      this.addViewConfigKey(viewID, key);
    },
  },
});
