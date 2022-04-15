import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
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
  getters: {
    getViewProxy() {
      return <T extends vtkViewProxy>(id: string) => {
        return this.$proxies.getView<T>(id);
      };
    },
    getDataRepresentationForView() {
      return (dataID: string, viewID: string) => {
        return this.$proxies.getDataRepresentationForView(dataID, viewID);
      };
    },
  },
  actions: {
    setLayout(layout: Layout) {
      this.layout = layout;
    },
  },
});
