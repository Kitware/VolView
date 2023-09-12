import { computed, ref, Ref, watch } from 'vue';

export function useMultiSelection<T = string>(allItems: Ref<T[]>) {
  const selected = ref<T[]>([]) as Ref<T[]>;

  // remove deleted item
  watch(allItems, () => {
    selected.value = selected.value.filter((item) =>
      allItems.value.includes(item)
    );
  });

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
      selected.value = allItems.value;
    }
  };

  return { selected, selectedAll, selectedSome, toggleSelectAll };
}
