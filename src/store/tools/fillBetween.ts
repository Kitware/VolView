import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useFillBetweenStore = defineStore('fillBetween', () => {
  type FillMode = 'start' | 'computing' | 'previewing';
  const mode = ref<FillMode>('start');

  function setMode(newMode: FillMode) {
    mode.value = newMode;
  }

  async function computeFillBetween() {
    mode.value = 'computing';

    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    mode.value = 'previewing';
  }

  function confirmFill() {
    mode.value = 'start';
  }

  function cancelFill() {
    mode.value = 'start';
  }

  return { mode, setMode, computeFillBetween, confirmFill, cancelFill };
});
