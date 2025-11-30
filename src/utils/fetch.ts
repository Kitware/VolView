import { parseUrl } from '@/src/utils/url';
import { Awaitable } from '@vueuse/core';

export const globalHeaders = new Headers();

export function setGlobalHeader(name: string, value: string) {
  globalHeaders.set(name, value);
}

export function deleteGlobalHeader(name: string) {
  globalHeaders.delete(name);
}

/**
 * Merges two headers.
 *
 * If a header exists in both the base and supplement, the supplement header takes priority.
 *
 * Does not handle duplicate headers.
 */
function mergeHeaders(base: Headers, supplementInit?: HeadersInit) {
  const merged = new Headers(base);
  const supplement = new Headers(supplementInit);
  supplement.forEach((value, name) => {
    merged.set(name, value);
  });
  return merged;
}

export const $fetch: typeof fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  return fetch(input, {
    ...init,
    headers: mergeHeaders(globalHeaders, init?.headers),
  });
};

/**
 * Percent is in [0, 1]. If it's Infinity, then the progress is indeterminate.
 */
export type ProgressCallback = (percent: number) => void;

export interface FetchCache<T> extends Map<string, Awaitable<T>> {}

export interface FetchOptions<T> {
  progress?: ProgressCallback;
  cache?: FetchCache<T>;
}

interface URLHandler {
  testURL(url: string): boolean;
  fetchURL(url: string, options?: FetchOptions<unknown>): Promise<Blob | null>;
}

/**
 * Handles HTTP(S) connections.
 *
 * Progress is approximate, given that data can be sent over gzipped.
 */
const HTTPHandler: URLHandler = {
  testURL: (url) => {
    const { protocol } = parseUrl(url, window.location.href);
    return protocol === 'http:' || protocol === 'https:';
  },
  fetchURL: async (url, options = {}) => {
    const { progress } = options;

    const response = await $fetch(url);
    if (response.status !== 200) {
      throw new Error(
        `Fetching resource failed (HTTP code ${response.status})`
      );
    }

    if (!progress) {
      return response.blob();
    }

    const contentLength = Number(response.headers.get('content-length')) || -1;
    if (contentLength < 0) {
      progress(Infinity);
      return response.blob();
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return null;
    }

    const bytes = new Uint8Array(contentLength);
    let recv = 0;
    let done = false;
    do {
      const readData = await reader.read();
      done = readData.done;
      if (readData.value && !done) {
        bytes.set(readData.value, recv);
        recv += readData.value.length;
        progress(recv / contentLength);
      }
    } while (!done);

    return new Blob([bytes]);
  },
};

const HANDLERS = [HTTPHandler];

export function canFetchUrl(url: string) {
  return !!HANDLERS.find((h) => h.testURL(url));
}

/**
 * Fetches a file.
 * @returns a File instance.
 */
export async function fetchFile(
  url: string,
  name: string,
  options?: FetchOptions<File>
) {
  const handler = HANDLERS.find((h) => h.testURL(url));
  if (!handler) {
    throw new Error(`Cannot find a handler for URL: ${url}`);
  }

  const cache = options?.cache;
  if (cache?.has(url)) {
    return cache.get(url)!;
  }

  const promise = handler.fetchURL(url, options).then((blob) => {
    if (!blob) {
      throw new Error(`Failed to download ${url}`);
    }
    return new File([blob], name);
  });

  // allow trying again on the off-chance the error is transient
  promise.catch(() => {
    cache?.delete(url);
  });

  cache?.set(url, promise);
  return promise;
}

/**
 * Fetches json.
 * @returns json data
 */
export async function fetchJSON<T>(url: string, options?: FetchOptions<T>) {
  const handler = HANDLERS.find((h) => h.testURL(url));
  if (!handler) {
    throw new Error(`Cannot find a handler for URL: ${url}`);
  }

  const blob = await handler.fetchURL(url, options);
  if (!blob) {
    throw new Error(`Failed to download ${url}`);
  }

  const buffer = await blob.arrayBuffer();
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(new Uint8Array(buffer))) as T;
}

export async function fetchFileWithProgress(
  url: string,
  name: string,
  progress: ProgressCallback,
  options: RequestInit | undefined
): Promise<File | null> {
  const response = await $fetch(url, options);
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
