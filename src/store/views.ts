import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { defineStore } from 'pinia';
import { DefaultViewSpec, InitViewSpecs } from '../config';
import { ViewProxyType } from '../core/proxies';
import { Layout, LayoutDirection } from '../types/layout';
import { useViewConfigStore } from './view-configs';
import { ViewSpec } from '../types/views';
import {
  StateFile,
  Layout as StateFileLayout,
  View,
} from '../io/state-file/schema';

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
        this.viewSpecs[id] = structuredClone(DefaultViewSpec);
      }
    },
    removeView(id: string) {
      if (id in this.viewSpecs) {
        delete this.viewSpecs[id];
        this.$proxies.deleteView(id);
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
    serialize(stateFile: StateFile) {
      const viewConfigStore = useViewConfigStore();
      const { manifest } = stateFile;
      const { views } = manifest;

      manifest.layout = this.layout as StateFileLayout;

      // Serialize the view specs
      Object.entries(this.viewSpecs).forEach(([id, spec]) => {
        const type = spec.viewType;
        const { props } = spec;
        const config = {};

        const view = {
          id,
          type,
          props,
          config,
        };

        views.push(view);
      });

      // Serialize the view config
      viewConfigStore.serialize(stateFile);
    },
    deserialize(views: View[], dataIDMap: Record<string, string>) {
      const viewConfigStore = useViewConfigStore();

      views.forEach((view) => {
        const viewID = view.id;

        const viewSpec = {
          viewType: view.type,
          props: view.props,
        };

        this.viewSpecs[viewID] = viewSpec;

        // Now delegate the deserialization of the view config
        const { config } = view;
        viewConfigStore.deserialize(viewID, config, dataIDMap);
      });
    },
  },
});
