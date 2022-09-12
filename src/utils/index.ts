import { api } from 'dicomweb-client';

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

interface DicomWebFetchOptions {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
}

export async function fetchDicomWeb(
  dicomWebServer: string,
  options: DicomWebFetchOptions
): Promise<File | null> {
  const client = new api.DICOMwebClient({
    url: dicomWebServer,
    retrieveRendered: false,
  });

  const instance = await client.retrieveInstance(options);
  const blob = new Blob([instance]);

  return new File([blob], 'asdf.dcm');
}
