import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDataBrowserStore = defineStore('data-browser', () => {
  const hideSampleData = ref(import.meta.env.VITE_SHOW_SAMPLE_DATA !== 'true');
  /** The image whose Info dialog is open. */
  const infoImageID = ref<string | null>(null);

  return {
    hideSampleData,
    infoImageID,
  };
});
