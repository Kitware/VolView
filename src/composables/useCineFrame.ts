import { computed, MaybeRef, unref } from 'vue';
import { clampValue } from '@/src/utils';
import { Maybe } from '@/src/types';
import { getCineImage } from '@/src/core/cine/isCineImage';
import { useCinePlaybackStore } from '@/src/store/view-configs/cine-playback';

export function useCineFrame(
  viewID: MaybeRef<Maybe<string>>,
  dataID: MaybeRef<Maybe<string>>
) {
  const playback = useCinePlaybackStore();
  const cine = computed(() => getCineImage(unref(dataID)));
  const frameMax = computed(() =>
    Math.max(0, (cine.value?.getNumberOfFrames() ?? 1) - 1)
  );
  const frameRange = computed<[number, number]>(() => [0, frameMax.value]);
  function setFrame(next: number) {
    const v = unref(viewID);
    const d = unref(dataID);
    if (!v || !d) return;
    playback.updateConfig(v, d, {
      frame: clampValue(next, 0, frameMax.value),
    });
  }
  const frame = computed({
    get: () =>
      clampValue(
        playback.getConfig(unref(viewID), unref(dataID)).frame,
        0,
        frameMax.value
      ),
    set: (value: number) => setFrame(value),
  });
  return { frame, frameRange, setFrame };
}
