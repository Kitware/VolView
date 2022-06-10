import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';

import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { getLPSAxisFromDir, LPSAxis, LPSAxisDir } from '@src/utils/lps';
import { ViewProxyType } from '../core/proxies';

export interface OrientationConfig {
  direction: LPSAxisDir;
  axis: LPSAxis;
}

const AXIS_TO_SLICEVIEW: Record<LPSAxis, ViewProxyType> = {
  Axial: ViewProxyType.Axial,
  Sagittal: ViewProxyType.Sagittal,
  Coronal: ViewProxyType.Coronal,
};

interface State {
  orientationConfigs: Record<string, OrientationConfig>;

  syncSlices: boolean;
  syncWindowing: boolean;
}

export const useView2DStore = defineStore('view2D', {
  state: (): State => ({
    orientationConfigs: {},
    syncSlices: true,
    syncWindowing: true,
  }),
  getters: {
    allViewIDs(state): string[] {
      return Object.keys(state.orientationConfigs);
    },
  },
  actions: {
    createView<T extends vtkViewProxy>(viewDirection: LPSAxisDir) {
      const id = this.$id.nextID();

      const axis = getLPSAxisFromDir(viewDirection);

      set<OrientationConfig>(this.orientationConfigs, id, {
        direction: viewDirection,
        axis,
      });

      return {
        id,
        proxy: <T>this.$proxies.createView(id, AXIS_TO_SLICEVIEW[axis]),
      };
    },
    removeView(id: string) {
      if (id in this.orientationConfigs) {
        del(this.orientationConfigs, id);
        this.$proxies.removeView(id);
      }
    },
  },
});
