import { computed, reactive, unref, type MaybeRef } from 'vue';

const pulseByMaskId = reactive<Record<string, number>>({});
const animationByMaskId = new Map<string, number>();

export const revealPulseStrength = (maskId: MaybeRef<string>) =>
  computed(() => pulseByMaskId[unref(maskId)] ?? 0);

export function pulseSegmentMask(maskId: string) {
  const previous = animationByMaskId.get(maskId);
  if (previous != null) cancelAnimationFrame(previous);

  const started = performance.now();
  const duration = 3000;
  const pulsePeriod = 500;
  const animate = (now: number) => {
    const elapsed = now - started;
    if (elapsed < duration) {
      pulseByMaskId[maskId] = Math.abs(
        Math.sin((Math.PI * elapsed) / pulsePeriod)
      );
      animationByMaskId.set(maskId, requestAnimationFrame(animate));
      return;
    }
    delete pulseByMaskId[maskId];
    animationByMaskId.delete(maskId);
  };

  animationByMaskId.set(maskId, requestAnimationFrame(animate));
}
