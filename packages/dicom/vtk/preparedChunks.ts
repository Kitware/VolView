export type PreparedChunks = {
  changed: boolean;
  commit: () => void;
  dispose: () => void;
};

export const unchangedChunks: PreparedChunks = {
  changed: false,
  commit: () => {},
  dispose: () => {},
};

/** A prepared allocation belongs to its caller until committed or discarded. */
export function preparedChunks(
  apply: () => void,
  release: () => void,
  signal: AbortSignal
): PreparedChunks {
  let pending = true;
  const detach = () => {
    pending = false;
    signal.removeEventListener('abort', dispose);
  };
  const dispose = () => {
    if (!pending) return;
    detach();
    release();
  };
  const commit = () => {
    if (!pending) return;
    detach();
    try {
      apply();
    } catch (error) {
      release();
      throw error;
    }
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return { changed: true, commit, dispose };
}
