/**
 * A controller that aborts as soon as any parent signal does, with its reason.
 * `release` detaches it from long-lived parents once its work is done.
 */
export function linkedController(...signals: AbortSignal[]) {
  const controller = new AbortController();
  const onAbort = (event: Event) =>
    controller.abort((event.target as AbortSignal).reason);
  const release = () =>
    signals.forEach((signal) => signal.removeEventListener('abort', onAbort));
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted) controller.abort(aborted.reason);
  else
    signals.forEach((signal) =>
      signal.addEventListener('abort', onAbort, { once: true })
    );
  controller.signal.addEventListener('abort', release, { once: true });
  return { controller, release };
}

export const abortError = (message: string) =>
  new DOMException(message, 'AbortError');

export const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === 'AbortError';

/** Settles with the signal's reason on abort, without stopping the work itself. */
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
