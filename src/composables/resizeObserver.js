import { onBeforeUnmount, unref, watch } from '@vue/composition-api';

/**
 * Invokes a callback whenever an element is resized.
 *
 * @param {Ref<HTMLElement>} targetElRef
 * @param {Function} callback
 */
export function useResizeObserver(targetElRef, callback) {
  const observer = new window.ResizeObserver((entries) => {
    if (entries.length === 1) {
      callback();
    }
  });

  watch(
    targetElRef,
    (targetEl, prevTarget) => {
      if (prevTarget) {
        observer.unobserve(prevTarget);
      }
      if (targetEl) {
        observer.observe(targetEl);
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    const targetEl = unref(targetElRef);
    if (targetEl) {
      observer.unobserve(targetEl);
    }
  });

  return observer;
}
