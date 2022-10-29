import { computed, ref, Ref, watch } from '@vue/composition-api';

export interface Panel {
  key: string;
  isOpen: boolean;
}

export function usePanels(keys: Ref<Set<string>>) {
  const panels = ref<Panel[]>([]);

  watch(
    keys,
    (newKeys, oldKeys) => {
      // remove deleted
      panels.value = panels.value.filter(({ key }) => newKeys.has(key));

      const addedKeys = [...newKeys].filter((key) => !oldKeys?.has(key));
      // order in temporal created order, not template order.  See https://github.com/vuetifyjs/vuetify/issues/11225
      panels.value = [
        ...panels.value,
        ...addedKeys.map((key) => ({ key, isOpen: true })),
      ];
    },
    // flush: 'post' keeps panels open when deleting patients
    // because panels.value has the same number panels in v-expansion-panels after flush
    { flush: 'post', immediate: true }
  );

  const handlePanelChange = (changeKey: string) => {
    const panel = panels.value.find(({ key }) => key === changeKey);
    panel!.isOpen = !panel!.isOpen;
  };

  const openPanels: Ref<number[]> = computed(() =>
    panels.value
      .map(({ isOpen }, idx) => ({ isOpen, idx }))
      .filter(({ isOpen }) => isOpen)
      .map(({ idx }) => idx)
  );

  return { handlePanelChange, openPanels };
}
