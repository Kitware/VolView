import { defineStore } from 'pinia';

const useDependencyInjectionStore = defineStore('dependencyInjection', {});

export const getIDMaker = () => {
  const { $id } = useDependencyInjectionStore();
  return $id;
};
