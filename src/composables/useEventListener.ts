import { onUnmounted, Ref, watch } from 'vue';
import { NOOP } from '../constants';

export function useEventListener(
  targetRef: Ref<HTMLElement | null | undefined>,
  eventName: string,
  listener: (evt: Event) => void
) {
  let cleanup = NOOP;

  watch(
    targetRef,
    (target) => {
      cleanup();
      cleanup = NOOP;

      if (target) {
        target.addEventListener(eventName, listener);
        cleanup = () => target.removeEventListener(eventName, listener);
      }
    },
    { immediate: true, flush: 'post' }
  );

  onUnmounted(cleanup);
}
