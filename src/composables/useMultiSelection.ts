import { computed, Ref, ref, UnwrapRef } from 'vue';

export function useMultiSelection<T = string>(allItems: Ref<T[]>) {
  const selected = ref<T[]>([]);
  const selectedSome = computed(() => selected.value.length > 0);
  const selectedAll = computed(
    () =>
      selected.value.length > 0 &&
      selected.value.length === allItems.value.length
  );

  const toggleSelectAll = () => {
    if (selectedAll.value) {
      selected.value = [];
    } else {
      selected.value = allItems.value as UnwrapRef<T[]>;
    }
  };

  return { selected, selectedAll, selectedSome, toggleSelectAll };
}
