export type Maybe<T> = T | null | undefined;
export type Awaitable<T> = T | Promise<T>;
/** Boundary padding accepted by numeric readers, without changing the stored text. */
export const trimDicomPadding = (value: string) =>
  value.replace(/^[\s\0]+|[\s\0]+$/g, '');

type PromiseResolveFunction<T> = (value: T) => void;
type PromiseRejectFunction = (reason?: any) => void;
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: PromiseResolveFunction<T>;
  reject: PromiseRejectFunction;
};

export function defer<T>(): Deferred<T> {
  let innerResolve: PromiseResolveFunction<T> | null = null;
  let innerReject: PromiseRejectFunction | null = null;

  const resolve = (value: T) => {
    if (innerResolve) innerResolve(value);
  };
  const reject = (reason?: Error) => {
    if (innerReject) innerReject(reason);
  };

  const promise = new Promise<T>((res, rej) => {
    innerResolve = res;
    innerReject = rej;
  });

  return { promise, resolve, reject };
}
export function concatBytes(
  parts: readonly Uint8Array[],
  length = parts.reduce((total, part) => total + part.length, 0)
) {
  const out = new Uint8Array(length);
  parts.reduce((offset, part) => {
    if (offset >= length) return offset;
    const slice = part.subarray(0, length - offset);
    out.set(slice, offset);
    return offset + slice.length;
  }, 0);
  return out;
}

export function toAscii(
  bytes: Uint8Array | Uint8ClampedArray,
  { ignoreNulls = false } = {}
) {
  const chars = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!(ignoreNulls && bytes[i] === 0)) {
      chars.push(String.fromCharCode(bytes[i]));
    }
  }
  return chars.join('');
}

/**
 * Wraps a generator as a coroutine.
 * @param generator
 * @param args
 * @returns
 */
export function asCoroutine<T, R, N>(gen: Generator<T, R, N>) {
  // run initial code
  const result = gen.next();
  if (result.done) return () => result;
  return (value: N): IteratorResult<T, R> => gen.next(value);
}
