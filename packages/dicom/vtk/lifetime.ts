/** Settle a consumer operation when its owner cancels, without transferring ownership of the work. */
export function untilAborted<T>(operation: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}
