import { defineStore } from 'pinia';

import { removeFromArray } from '@src/utils';
import { del, set } from '@vue/composition-api';

interface State {
  dataToProxyID: Record<string, string>;
  sources: string[];
}

export const useVTKProxyStore = defineStore('vtkProxy', {
  state: (): State => ({
    dataToProxyID: {},
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
  },
});
