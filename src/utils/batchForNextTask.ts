/**
 * Batches a function for the next JS task.
 *
 * Returns a function that wraps the given callback.
 * @param fn
 * @returns
 */
export function batchForNextTask<T extends (...args: any[]) => void>(fn: T) {
  let timeout: NodeJS.Timeout | null = null;
  const wrapper = ((...args: any[]) => {
    if (timeout != null) return;
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, 0);
  }) as T & { cancel: () => void };

  wrapper.cancel = () => {
    if (timeout != null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return wrapper;
}
