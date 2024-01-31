/**
 * Batches a function for the next JS task.
 *
 * Returns a function that wraps the given callback.
 * @param fn
 * @returns
 */
export function batchForNextTask(fn: () => void) {
  let timeout: NodeJS.Timeout | null = null;
  return () => {
    if (timeout != null) return;
    timeout = setTimeout(() => {
      timeout = null;
      fn();
    }, 0);
  };
}
