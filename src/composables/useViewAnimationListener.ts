import { View } from '@/src/core/vtk/useVtkView';
import useViewAnimationStore, {
  matchesViewFilter,
} from '@/src/store/view-animation';
import { storeToRefs } from 'pinia';
import { MaybeRef, computed, unref, watchEffect } from 'vue';

export function useViewAnimationListener(
  view: View,
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
    if (!animating.value) {
      view.interactor.cancelAnimation(store);
      requested = false;
    } else if (!requested && canAnimate.value) {
      view.interactor.requestAnimation(store);
      requested = true;
    }
  });
}
