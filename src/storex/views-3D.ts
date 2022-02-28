import { defineStore } from 'pinia';

export interface ColorByConfig {
  colorByArrayName: string;
  transferFunction: string;
}

interface State {
  colorByConfigs: Record<string, ColorByConfig>;
}

export const useView3DStore = defineStore('views-3D', {
  state: () => ({} as State),
  actions: {
    // addView(id: string) {},
    // removeView(id: string) {},
  },
});
