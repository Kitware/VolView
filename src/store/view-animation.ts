import { defineStore } from 'pinia';
import { ref, shallowRef, triggerRef, computed } from 'vue';

export interface ViewFilterSpec {
  byViewType?: string[];
  byViewIds?: string[];
}

export function matchesViewFilter(
  viewID: string,
  viewType: string,
  filterSpec?: ViewFilterSpec
) {
  if (!filterSpec) return true;
  const { byViewType, byViewIds } = filterSpec;
  if (byViewType && !byViewType.includes(viewType)) return false;
  if (byViewIds && !byViewIds.includes(viewID)) return false;
  return true;
}

function mergeArrayFilters(arr1?: string[], arr2?: string[]) {
  if (!arr1 || !arr2) return undefined;
  return Array.from(new Set(arr1.concat(arr2)));
}

/**
 * Merges view filter specs.
 *
 * An undefined filter spec means no filter.
 * @param filterSpecs
 * @returns
 */
export function mergeViewFilters(
  filterSpecs: Array<ViewFilterSpec | undefined>
) {
  if (filterSpecs.length === 0) return undefined;
  return filterSpecs.reduce((result, spec) => {
    if (result === undefined) return undefined;
    const byViewIds = mergeArrayFilters(result?.byViewIds, spec?.byViewIds);
    const byViewType = mergeArrayFilters(result?.byViewType, spec?.byViewType);
    return { byViewIds, byViewType };
  }, filterSpecs[0] as ViewFilterSpec | undefined);
}

const useViewAnimationStore = defineStore('viewAnimation', () => {
  const animating = ref(false);
  const requestors = shallowRef(new Map<any, ViewFilterSpec | undefined>());
  const viewFilter = computed(() => {
    return mergeViewFilters(Array.from(requestors.value.values()));
  });

  const requestAnimation = (requestor: any, filter?: ViewFilterSpec) => {
    if (requestors.value.has(requestor)) return;
    requestors.value.set(requestor, filter);
    animating.value = true;
    triggerRef(requestors);
  };

  const cancelAnimation = (requestor: any) => {
    requestors.value.delete(requestor);
    if (requestors.value.size === 0) {
      animating.value = false;
    }
    triggerRef(requestors);
  };

  return {
    animating,
    viewFilter,
    requestAnimation,
    cancelAnimation,
  };
});

export default useViewAnimationStore;
