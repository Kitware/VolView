import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';

import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { clampValue } from '@src/utils';
import { getLPSAxisFromDir, LPSAxis, LPSAxisDir } from '@src/utils/lps';
import { ViewProxyType } from '../core/proxies';

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

export interface ViewConfig {
  direction: LPSAxisDir;
  axis: LPSAxis;
}

export const defaultSliceConfig = (): SliceConfig => ({
  slice: 0,
  min: 0,
  max: 1,
});

export const defaultWindowLevelConfig = (): WindowLevelConfig => ({
  width: 1,
  level: 0,
  min: 0,
  max: 1,
});

const AXIS_TO_SLICEVIEW: Record<LPSAxis, ViewProxyType> = {
  Axial: ViewProxyType.Axial,
  Sagittal: ViewProxyType.Sagittal,
  Coronal: ViewProxyType.Coronal,
};

interface State {
  viewConfigs: Record<string, ViewConfig>;
  sliceConfigs: Record<string, SliceConfig>;
  wlConfigs: Record<string, WindowLevelConfig>;
  // removes the necessity to have links in proxy.js
  // syncs across all views sharing the same image ID
  syncSlices: boolean;
  syncWindowing: boolean;
}

export const useView2DStore = defineStore('view2D', {
  state: (): State => ({
    viewConfigs: {},
    sliceConfigs: {},
    wlConfigs: {},
    syncSlices: true,
    syncWindowing: true,
  }),
  actions: {
    createView<T extends vtkViewProxy>(
      viewDirection: LPSAxisDir,
      sliceDomain?: [number, number],
      wlDomain?: [number, number]
    ) {
      const id = this.$id.nextID();
      const axis = getLPSAxisFromDir(viewDirection);

      set<ViewConfig>(this.viewConfigs, id, {
        direction: viewDirection,
        axis,
      });

      const sliceRange = sliceDomain ?? [0, 1];
      set<SliceConfig>(this.sliceConfigs, id, {
        slice: Math.floor((sliceRange[0] + sliceRange[1]) / 2),
        min: sliceRange[0],
        max: sliceRange[1],
      });

      const wlRange = wlDomain ?? [0, 1];
      set<WindowLevelConfig>(this.wlConfigs, id, {
        width: wlRange[1] - wlRange[0],
        level: (wlRange[0] + wlRange[1]) / 2,
        min: wlRange[0],
        max: wlRange[1],
      });

      return {
        id,
        proxy: <T>this.$proxies.createView(id, AXIS_TO_SLICEVIEW[axis]),
      };
    },
    removeView(id: string) {
      if (id in this.sliceConfigs && id in this.wlConfigs) {
        del(this.viewConfigs, id);
        del(this.sliceConfigs, id);
        del(this.wlConfigs, id);
        this.$proxies.removeView(id);
      }
    },
    setSlice(id: string, slice: number) {
      if (id in this.sliceConfigs) {
        const viewsToUpdate = this.syncSlices
          ? Object.keys(this.sliceConfigs)
          : [id];

        const { axis } = this.viewConfigs[id];

        // sync slices across all views that share the same dataset and axis.
        // Right now, all views share the same dataset by way of primarySelection.
        viewsToUpdate.forEach((viewID) => {
          if (this.viewConfigs[viewID].axis === axis) {
            const config = this.sliceConfigs[viewID];
            const { min, max } = config;
            config.slice = clampValue(slice, min, max);
          }
        });
      }
    },
    updateSliceDomain(id: string, sliceDomain: [number, number]) {
      if (id in this.sliceConfigs) {
        const config = this.sliceConfigs[id];
        const [min, max] = sliceDomain;
        config.min = min;
        config.max = max;
        if (config.slice < min || config.slice > max) {
          config.slice = Math.floor((min + max) / 2);
        }
      }
    },
    resetSlice(id: string) {
      if (id in this.sliceConfigs) {
        const config = this.sliceConfigs[id];
        this.setSlice(id, Math.floor((config.min + config.max) / 2));
      }
    },
    setWindowLevel(id: string, wl: { width?: number; level?: number }) {
      if (id in this.wlConfigs) {
        const viewsToUpdate = this.syncWindowing
          ? Object.keys(this.wlConfigs)
          : [id];

        // sync windowing across all views that share the same dataset.
        // Right now, all views share the same dataset by way of primarySelection.
        viewsToUpdate.forEach((viewID) => {
          const config = this.wlConfigs[viewID];
          // don't constrain w/l to min/max
          if ('width' in wl) {
            config.width = wl.width!;
          }
          if ('level' in wl) {
            config.level = wl.level!;
          }
        });
      }
    },
    updateWLDomain(id: string, wlDomain: [number, number]) {
      if (id in this.wlConfigs) {
        const config = this.wlConfigs[id];
        const [min, max] = wlDomain;
        config.min = min;
        config.max = max;
      }
    },
    resetWindowLevel(id: string) {
      if (id in this.wlConfigs) {
        const config = this.wlConfigs[id];
        const width = config.max - config.min;
        const level = (config.max + config.min) / 2;
        this.setWindowLevel(id, { width, level });
      }
    },
  },
});
