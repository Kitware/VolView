import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { del, set } from '@vue/composition-api';
import { defineStore } from 'pinia';
import { DefaultViewSpec, InitViewSpecs } from '../config';
import { ViewProxyType } from '../core/proxies';
import { Layout, LayoutDirection } from '../types/layout';
import { ViewSpec } from '../types/views';

interface State {
  layout: Layout;
  viewSpecs: Record<string, ViewSpec>;
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    layout: {
      direction: LayoutDirection.V,
      items: [],
    },
    viewSpecs: structuredClone(InitViewSpecs),
  }),
  getters: {
    viewIDs(state) {
      return Object.keys(state.viewSpecs);
    },
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
      return (
        this.$proxies.getView<T>(id) ?? <T>this.$proxies.createView(id, type)
      );
    },
    addView(id: string) {
      if (!(id in this.viewSpecs)) {
        set(this.viewSpecs, id, structuredClone(DefaultViewSpec));
      }
    },
    removeView(id: string) {
      if (id in this.viewSpecs) {
        del(this.viewSpecs, id);
        this.$proxies.removeView(id);
      }
    },
    setLayout(layout: Layout) {
      this.layout = layout;

      const layoutsToProcess = [layout];
      while (layoutsToProcess.length) {
        const ly = layoutsToProcess.shift()!;
        ly.items.forEach((item) => {
          if (typeof item === 'string') {
            // item is a view ID
            this.addView(item);
          } else {
            layoutsToProcess.push(item);
          }
        });
      }
    },
  },
});
