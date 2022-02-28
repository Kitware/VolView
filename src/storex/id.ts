import { defineStore } from 'pinia';

const START_ID = 1;

export const useIDStore = defineStore('ID', {
  state: () => ({
    id: START_ID,
  }),
  actions: {
    getNextID() {
      const { id } = this;
      this.id += 1;
      return String(id);
    },
    reset() {
      this.id = START_ID;
    },
  },
});
