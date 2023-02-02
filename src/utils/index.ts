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

export function arrayEquals<T>(a: T[], b: T[]) {
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
 *
 * Requires that the URL global be present.
 */
export function getURLBasename(url: string) {
  return new URL(url).pathname.split('/').at(-1) ?? '';
}
