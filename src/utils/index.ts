import { URL } from 'whatwg-url';
import { TypedArray } from 'itk-wasm';
import { EPSILON } from '../constants';

export function identity<T>(arg: T) {
  return arg;
}

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

export const isFulfilled = <T>(
  input: PromiseSettledResult<T>
): input is PromiseFulfilledResult<T> => input.status === 'fulfilled';

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

export const pluck =
  <T, K extends keyof T>(key: K) =>
  (obj: T): T[K] =>
    obj[key];

/**
 * Takes a predicate and a list of values and returns a a tuple (2-item array),
 *  with each item containing the subset of the list that matches the predicate
 *  and the complement of the predicate respectively
 *
 * @sig (T -> Boolean, T[]) -> [T[], T[]]
 *
 * @param {Function} predicate A predicate to determine which side the element belongs to.
 * @param {Array} arr The list to partition
 *
 * Inspired by the Ramda function of the same name
 * @see https://ramdajs.com/docs/#partition
 *
 * @example
 *
 *     const isNegative: (n: number) => boolean = n => n < 0
 *     const numbers = [1, 2, -4, -7, 4, 22]
 *     partition(isNegative, numbers)
 *     // => [ [-4, -7], [1, 2, 4, 22] ]
 *
 * Source https://gist.github.com/zachlysobey/71ac85046d0d533287ed85e1caa64660
 */
export function partition<T>(
  predicate: (val: T) => boolean,
  arr: Array<T>
): [Array<T>, Array<T>] {
  const partitioned: [Array<T>, Array<T>] = [[], []];
  arr.forEach((val: T) => {
    const partitionIndex: 0 | 1 = predicate(val) ? 0 : 1;
    partitioned[partitionIndex].push(val);
  });
  return partitioned;
}

export const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_: any, i: number) =>
    arr.slice(i * size, i * size + size)
  );

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

type ComparatorFunction<T> = (a: T, b: T) => boolean;
export function arrayEqualsWithComparator<T>(
  a: T[],
  b: T[],
  cmp: ComparatorFunction<T>
) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cmp(a[i], b[i])) return false;
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

export function roundIfCloseToInteger(value: number, eps = EPSILON) {
  const rounded = Math.round(value);
  if (Math.abs(rounded - value) <= eps) {
    return rounded;
  }
  return value;
}

export function hasKey<O extends Object>(
  obj: O,
  key: PropertyKey
): key is keyof O {
  return key in obj;
}

export function remapKeys<O extends Object, K extends keyof O>(
  obj: O,
  keyMap: Record<K, K>
) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (hasKey(keyMap, key)) return [keyMap[key], value];
      throw new Error(`Key ${key} not found in keyMap`);
    })
  );
}

// return object without the given keys
export const omit = <T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[] | K
) =>
  Object.fromEntries(
    Object.entries(obj).filter(([key]) => !wrapInArray(keys).includes(key as K))
  ) as Omit<T, K>;

export function ensureError(e: unknown) {
  return e instanceof Error ? e : new Error(JSON.stringify(e));
}

// remove undefined properties
export function cleanUndefined(obj: Object) {
  return Object.entries(obj).reduce(
    (cleaned, [key, value]) =>
      value === undefined ? cleaned : { ...cleaned, [key]: value },
    {}
  );
}
