import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDataBrowserStore = defineStore('data-browser', () => {
  const hideSampleData = ref(import.meta.env.VITE_SHOW_SAMPLE_DATA !== 'true');

  return {
    hideSampleData,
  };
});
