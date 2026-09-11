import { computed, reactive, unref, type MaybeRef } from 'vue';

const pulseByMaskId = reactive<Record<string, number>>({});
const animationByMaskId = new Map<string, number>();

export const revealPulseStrength = (maskId: MaybeRef<string>) =>
  computed(() => pulseByMaskId[unref(maskId)] ?? 0);

/** Briefly rises from the normal display to a highlight and settles back. */
export function pulseSegmentMask(maskId: string) {
  const previous = animationByMaskId.get(maskId);
  if (previous != null) cancelAnimationFrame(previous);

  const started = performance.now();
  const duration = 1000;
  const animate = (now: number) => {
    const progress = Math.min((now - started) / duration, 1);
    pulseByMaskId[maskId] = Math.abs(Math.sin(2 * Math.PI * progress));
    if (progress < 1) {
      animationByMaskId.set(maskId, requestAnimationFrame(animate));
      return;
    }
    delete pulseByMaskId[maskId];
    animationByMaskId.delete(maskId);
  };

  animationByMaskId.set(maskId, requestAnimationFrame(animate));
}
