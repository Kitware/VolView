import { reactive } from 'vue';

const pulseBySegmentId = reactive<Record<string, number>>({});
const animationBySegmentId = new Map<string, number>();

/** Reactive pulse strength in 0..1, zero when the segment is not pulsing. */
export const revealPulse = (segmentId: string) =>
  pulseBySegmentId[segmentId] ?? 0;

export function pulseSegmentMask(segmentId: string) {
  const previous = animationBySegmentId.get(segmentId);
  if (previous != null) cancelAnimationFrame(previous);

  const started = performance.now();
  const duration = 3000;
  const pulsePeriod = 500;
  const animate = (now: number) => {
    const elapsed = now - started;
    if (elapsed < duration) {
      pulseBySegmentId[segmentId] = Math.abs(
        Math.sin((Math.PI * elapsed) / pulsePeriod)
      );
      animationBySegmentId.set(segmentId, requestAnimationFrame(animate));
      return;
    }
    delete pulseBySegmentId[segmentId];
    animationBySegmentId.delete(segmentId);
  };

  animationBySegmentId.set(segmentId, requestAnimationFrame(animate));
}
