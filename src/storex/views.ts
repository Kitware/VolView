import { defineStore } from 'pinia';
import { LPSAxisDir } from '../utils/lps';

export type ViewType = '2D' | '3D';

export interface View2DConfig {
  objType: 'View2D';
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

export interface View3DConfig {
  objType: 'View3D';
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

export type ViewConfig = View2DConfig | View3DConfig;

export type Layout =
  | {
      objType: 'Layout';
      direction: 'V' | 'H';
      items: Array<Layout | ViewConfig>;
    }
  | ViewConfig;

interface State {
  layout: Layout;
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    layout: {
      objType: 'Layout',
      direction: 'V',
      items: [],
    },
  }),
  actions: {
    setLayout(layout: Layout) {
      this.layout = layout;
    },
  },
});
