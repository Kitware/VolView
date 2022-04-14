import { onBeforeUnmount, Ref, unref, watch } from '@vue/composition-api';

/**
 * Invokes a callback whenever an element is resized.
 */
export function useResizeObserver(
  targetElRef: Ref<Element | null | undefined>,
  callback: (entry: ResizeObserverEntry) => void
) {
  const observer = new ResizeObserver((entries) => {
    if (entries.length === 1) {
      callback(entries[0]);
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
