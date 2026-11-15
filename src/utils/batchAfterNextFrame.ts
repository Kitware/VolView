/**
 * Batches calls into one invocation per animation frame, run in a task after
 * the frame so queued input is handled first.
 */
export function batchAfterNextFrame(fn: () => void) {
  let frame: number | null = null;
  let task: ReturnType<typeof setTimeout> | null = null;

  const wrapper = () => {
    if (frame != null || task != null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      task = setTimeout(() => {
        task = null;
        fn();
      }, 0);
    });
  };

  wrapper.cancel = () => {
    if (frame != null) cancelAnimationFrame(frame);
    if (task != null) clearTimeout(task);
    frame = null;
    task = null;
  };

  return wrapper;
}
