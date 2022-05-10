import { Ref, watch } from '@vue/composition-api';

export function useEventListener(
  targetRef: Ref<HTMLElement | null | undefined>,
  eventName: string,
  listener: (evt: Event) => void
) {
  watch(
    targetRef,
    (target, oldTarget) => {
      if (oldTarget) {
        oldTarget.removeEventListener(eventName, listener);
      }
      if (target) {
        target.addEventListener(eventName, listener);
      }
    },
    { immediate: true, flush: 'post' }
  );
}
