import {
  computed,
  Ref,
  ref,
  UnwrapRefSimple,
  watch,
} from '@vue/composition-api';

export function useMultiSelection<T = string>(allItems: Ref<T[]>) {
  const selected = ref<T[]>([]);
  const selectedAll = ref(false);
  const selectedSome = computed(() => selected.value.length > 0);

  watch(selected, () => {
    selectedAll.value =
      selected.value.length > 0 &&
      selected.value.length === allItems.value.length;
  });

  watch(selectedAll, (yn) => {
    if (yn) {
      selected.value = allItems.value as UnwrapRefSimple<T[]>;
    } else {
      selected.value = [];
    }
  });

  return { selected, selectedAll, selectedSome };
}
