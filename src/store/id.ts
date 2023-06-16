import { defineStore } from 'pinia';

const START_ID = 0;

export const useIdStore = defineStore('id', () => {
  let id: number = START_ID;
  return {
    nextId() {
      return String(++id);
    },
    reset() {
      id = START_ID;
    },
  };
});
