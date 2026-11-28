import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import { useElementSize } from '@vueuse/core';

/** Whether the layout pane holding `anchor` is narrower than `width` pixels. */
export function useNarrowPane(
  anchor: Readonly<Ref<HTMLElement | null>>,
  width: MaybeRefOrGetter<number>
) {
  const pane = computed(() =>
    anchor.value?.closest<HTMLElement>('.layout-item')
  );
  // Border-box matches the pane bounds the divider limits use.
  const size = useElementSize(
    pane,
    { width: 0, height: 0 },
    { box: 'border-box' }
  );
  return computed(
    () => size.width.value > 0 && size.width.value < toValue(width)
  );
}
