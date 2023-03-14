import { TypedArray } from 'itk-wasm';
import { URL } from 'whatwg-url';

/**
 * Percent is in [0, 1]. If it's Infinity, then the progress is indeterminate.
 */
export type ProgressCallback = (percent: number) => void;

export async function fetchFileWithProgress(
  url: string,
  name: string,
  progress: ProgressCallback,
  options: RequestInit | undefined
): Promise<File | null> {
  const response = await fetch(url, options);
  const contentLength = Number(response.headers.get('content-length')) || 0;

  if (contentLength <= 0) {
    progress(Infinity);

    const blob = await response.blob();
    return new File([blob], name);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }

  const bytes = new Uint8Array(contentLength);
  let recv = 0;
  let done = false;
  do {
    // eslint-disable-next-line no-await-in-loop
    const readData = await reader.read();
    done = readData.done;
    if (readData.value && !done) {
      bytes.set(readData.value, recv);
      recv += readData.value.length;
      progress(recv / contentLength);
    }
  } while (!done);

  return new File([bytes], name);
}

/**
 * Fetches a file.
 * @returns a File instance
 */
export async function fetchFile(
  url: string,
  name: string,
  options?: RequestInit
) {
  const response = await fetch(url, options);
  const blob = await response.blob();
  return new File([blob], name);
}

type PromiseResolveFunction<T> = (value: T) => void;
type PromiseRejectFunction = (reason?: Error) => void;
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: PromiseResolveFunction<T>;
  reject: PromiseRejectFunction;
}

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

export function removeFromArray<T>(arr: Array<T>, el: T) {
  const idx = arr.indexOf(el);
  if (idx > -1) {
    arr.splice(idx, 1);
  }
}

export function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function pick<T, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
  return keys.reduce((o, k) => ({ ...o, [k]: obj[k] }), {} as Pick<T, K>);
}

export function plural(n: number, word: string, pluralWord?: string) {
  return n > 1 ? pluralWord ?? `${word}s` : word;
}

export const ensureDefault = <T>(
  key: string,
  records: Record<string, T>,
  default_: T
) => {
  if (!(key in records)) {
    // eslint-disable-next-line no-param-reassign
    records[key] = default_;
  }

  return records[key];
};

type ArrayLike<T> = T extends unknown[] ? T : T extends TypedArray ? T : never;
export function arrayEquals<T>(a: ArrayLike<T>, b: ArrayLike<T>) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Wraps non-arrays in an array.
 * @param maybeArray
 */
export function wrapInArray<T>(maybeArray: T | T[]): T[] {
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

/**
 * Extracts the basename from a URL.
 */
export function getURLBasename(url: string) {
  return new URL(url, window.location.href).pathname.split('/').at(-1) ?? '';
}

// from https://stackoverflow.com/a/18650828
export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}
