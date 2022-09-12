import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { defineStore } from 'pinia';
import { ViewProxyType } from '../core/proxies';
import { Layout, LayoutDirection } from '../types/layout';

interface State {
  layout: Layout;
  views: string[];
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    layout: {
      objType: 'Layout',
      direction: LayoutDirection.V,
      items: [],
    },
    views: [],
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
    createOrGetViewProxy<T extends vtkViewProxy = vtkViewProxy>(
      id: string,
      type: ViewProxyType
    ) {
      if (this.views.indexOf(id) > -1) {
        return this.getViewProxy<T>(id)!;
      }
      this.views.push(id);
      return <T>this.$proxies.createView(id, type);
    },
    removeView(id: string) {
      const idx = this.views.indexOf(id);
      if (idx > -1) {
        this.views.splice(idx, 1);
      }
      this.$proxies.removeView(id);
    },
    setLayout(layout: Layout) {
      this.layout = layout;
    },
  },
});
