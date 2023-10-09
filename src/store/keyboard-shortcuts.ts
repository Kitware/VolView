import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useKeyboardShortcutsStore = defineStore(
  'keyboardShortcuts',
  () => {
    const settingsOpen = ref(false);

    return {
      settingsOpen,
    };
  }
);
