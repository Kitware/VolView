import { defineStore } from 'pinia';

interface State {
  resetViews: number;
}

export const useCustomEvents = defineStore('customEvents', {
  state: (): State => ({
    resetViews: 0,
  }),
  actions: {
    triggerResetViews() {
      return ++this.resetViews;
    }
  }
});
