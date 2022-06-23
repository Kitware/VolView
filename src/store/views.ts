import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { defineStore } from 'pinia';
import { LPSAxisDir } from '../utils/lps';

export type ViewType = '2D' | '3D';

export enum LayoutDirection {
  V = 'V',
  H = 'H',
}

export enum ViewKey {
  CoronalView = 'CoronalView',
  SagittalView = 'SagittalView',
  AxialView = 'AxialView',
  ThreeDView = '3DView',
}

export interface View2DConfig {
  objType: 'View2D';
  key: ViewKey;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

export interface View3DConfig {
  objType: 'View3D';
  key: ViewKey;
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

export type ViewConfig = View2DConfig | View3DConfig;

export type Layout =
  | {
      objType: 'Layout';
      direction: LayoutDirection;
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
      direction: LayoutDirection.V,
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
      return <T extends vtkAbstractRepresentationProxy>(
        dataID: string,
        viewID: string
      ) => {
        return <T | null>(
          this.$proxies.getDataRepresentationForView(dataID, viewID)
        );
      };
    },
  },
  actions: {
    setLayout(layout: Layout) {
      this.layout = layout;
    },
  },
});
