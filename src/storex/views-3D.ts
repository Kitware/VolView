import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

export interface ColorBy {
  arrayName: string;
  location: string;
}
export interface ColoringConfig {
  colorBy: ColorBy;
  transferFunction: string;
}

interface State {
  coloringConfigs: Record<string, ColoringConfig>;
}

export const useView3DStore = defineStore('views-3D', {
  state: () =>
    ({
      coloringConfigs: {},
    } as State),
  actions: {
    addView(id: string) {
      if (!(id in this.coloringConfigs)) {
        set<ColoringConfig>(this.coloringConfigs, id, {
          colorBy: {
            arrayName: '',
            location: '',
          },
          transferFunction: DEFAULT_PRESET,
        });
      }
    },
    removeView(id: string) {
      del(this.coloringConfigs, id);
    },
  },
});
