import { onScopeDispose, unref, watch, type MaybeRef } from 'vue';
import type { Maybe } from '@/src/types';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { windowLevelFromDrag } from './windowLevel';

export function useEnFaceWindowLevelDrag(options: {
  viewId: MaybeRef<string>;
  imageId: MaybeRef<Maybe<string>>;
  ready: MaybeRef<boolean>;
  range: MaybeRef<{ min: number; max: number }>;
  config: MaybeRef<{ width: number; level: number }>;
}) {
  const { viewId, imageId, ready, range, config } = options;
  const tools = useToolStore();
  const views = useViewStore();
  const windowing = useWindowingStore();
  let drag: {
    target: HTMLCanvasElement;
    pointerId: number;
    x: number;
    y: number;
    viewport: { width: number; height: number };
    initial: { width: number; level: number };
    range: { min: number; max: number };
  } | null = null;

  function startWindowing(event: PointerEvent) {
    if (
      event.button !== 0 ||
      tools.currentTool !== Tools.WindowLevel ||
      !unref(ready)
    )
      return;
    const target = event.currentTarget as HTMLCanvasElement;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    views.setActiveView(unref(viewId));
    target.focus({ preventScroll: true });
    drag = {
      target,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      viewport: { width: rect.width, height: rect.height },
      initial: { ...unref(config) },
      range: { ...unref(range) },
    };
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveWindowing(event: PointerEvent) {
    const imageID = unref(imageId);
    if (!drag || event.pointerId !== drag.pointerId || !imageID) return;
    const value = windowLevelFromDrag(
      drag.initial,
      drag.range,
      { x: event.clientX - drag.x, y: event.clientY - drag.y },
      drag.viewport
    );
    windowing.updateConfig(unref(viewId), imageID, value, true);
  }
  function stopWindowing() {
    const previous = drag;
    drag = null;
    if (previous?.target.hasPointerCapture(previous.pointerId))
      previous.target.releasePointerCapture(previous.pointerId);
  }
  watch(
    [
      () => unref(imageId),
      () => unref(viewId),
      () => tools.currentTool,
      () => unref(ready),
    ],
    stopWindowing
  );
  onScopeDispose(stopWindowing);
  return { startWindowing, moveWindowing, stopWindowing };
}
