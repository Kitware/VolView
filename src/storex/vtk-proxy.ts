import { defineStore } from 'pinia';

import { removeFromArray } from '@src/utils';
import { del, set } from '@vue/composition-api';

interface State {
  dataToProxyID: Record<string, string>;
  viewToProxyID: Record<string, string>;
  sources: string[];
}

export const useVTKProxyStore = defineStore('vtkProxy', {
  state: (): State => ({
    dataToProxyID: Object.create(null),
    viewToProxyID: Object.create(null),
    sources: [],
  }),
  actions: {
    addSource(dataID: string, proxyID: string) {
      if (!(dataID in this.dataToProxyID)) {
        set(this.dataToProxyID, dataID, proxyID);
        this.sources.push(proxyID);
      }
    },
    removeSource(dataID: string) {
      if (dataID in this.dataToProxyID) {
        removeFromArray(this.sources, this.dataToProxyID[dataID]);
        del(this.dataToProxyID, dataID);
      }
    },
    addView(viewID: string, proxyID: string) {
      set(this.viewToProxyID, viewID, proxyID);
    },
    removeView(viewID: string) {
      del(this.viewToProxyID, viewID);
    },
  },
});
