import { View } from '@/src/core/vtk/types';
import useViewAnimationStore, {
  matchesViewFilter,
} from '@/src/store/view-animation';
import { Maybe } from '@/src/types';
import { storeToRefs } from 'pinia';
import { MaybeRef, computed, unref, watchEffect } from 'vue';

export function useViewAnimationListener(
  view: MaybeRef<Maybe<View>>,
  viewId: MaybeRef<string>,
  viewType: MaybeRef<string>
) {
  const store = useViewAnimationStore();
  const { animating, viewFilter } = storeToRefs(store);
  const canAnimate = computed(() =>
    matchesViewFilter(unref(viewId), unref(viewType), viewFilter.value)
  );

  let requested = false;

  watchEffect(() => {
    const viewVal = unref(view);
    if (!viewVal) return;

    if (!animating.value) {
      viewVal.interactor.cancelAnimation(store);
      requested = false;
    } else if (!requested && canAnimate.value) {
      viewVal.interactor.requestAnimation(store);
      requested = true;
    }
  });
}
