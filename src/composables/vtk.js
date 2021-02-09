import { onMounted, onUnmounted, watch } from '@vue/composition-api';

/**
 * Handles a vtk.js subscription lifecycle.
 * @param {Ref<vtkObject>} targetRef
 * @param {(vtkObject) => { unsubscribe: Function }} subFunc
 */
export function useSubscription(targetRef, subFunc) {
  let sub = null;

  function unsubscribe() {
    if (sub) sub.unsubscribe();
    sub = null;
  }

  function subscribe() {
    unsubscribe();
    if (targetRef.value) {
      sub = subFunc(targetRef.value);
    }
  }

  const stopHandle = watch(targetRef, subscribe);

  onMounted(() => {
    if (sub === null) {
      subscribe();
    }
  });

  onUnmounted(() => unsubscribe());

  return () => {
    stopHandle();
    unsubscribe();
  };
}
