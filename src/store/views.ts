import { defineStore } from 'pinia';
import { DefaultViewSpec, InitViewSpecs } from '../config';
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
  activeViewID: string;
}

export const useViewStore = defineStore('view', {
  state: (): State => ({
    layout: {
      direction: LayoutDirection.V,
      items: [],
    },
    viewSpecs: structuredClone(InitViewSpecs),
    activeViewID: '',
  }),
  getters: {
    viewIDs(state) {
      return Object.keys(state.viewSpecs);
    },
  },
  actions: {
    setActiveViewID(id: string) {
      this.activeViewID = id;
    },
    addView(id: string) {
      if (!(id in this.viewSpecs)) {
        this.viewSpecs[id] = structuredClone(DefaultViewSpec);
      }
    },
    removeView(id: string) {
      if (id in this.viewSpecs) {
        delete this.viewSpecs[id];
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
