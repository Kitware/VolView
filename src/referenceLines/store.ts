import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';

const STORAGE_KEY = 'referenceLinesEnabled';

export const useReferenceLinesStore = defineStore('referenceLines', () => {
  const enabled = useLocalStorage(STORAGE_KEY, false);
  const toolStore = useToolStore();

  // The crosshairs tool has no visuals of its own: the reference lines are what
  // it draws, so it turns them on for as long as it is active. Deriving this
  // rather than snapshotting is what restores the user's setting afterwards.
  const visible = computed(
    () => enabled.value || toolStore.currentTool === Tools.Crosshairs
  );

  return { enabled, visible };
});
