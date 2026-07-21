import { parseUrl } from '@/src/utils/url';
import { Awaitable } from '@vueuse/core';

export const globalHeaders = new Headers();

// Cross-origin reach of the global `Authorization` bearer. Only the bearer set
// from a `token=`/`tokenUrl=` URL param is ever governed by this; every other
// global header stays same-origin-only regardless (see $fetch).
//
//   * `same-origin` (default) — bearer never leaves the deployment's origin.
//   * `any-origin`            — an explicit `token=` the link author already
//                               holds; may ride to any origin (the documented
//                               cross-origin hosted-instance flow).
//   * `origin`                — a `tokenUrl=`-derived token, scoped to the
//                               issuing endpoint's own origin so a crafted link
//                               cannot exfiltrate a freshly-minted token to an
//                               attacker host.
export type BearerScope =
  | { kind: 'same-origin' }
  | { kind: 'any-origin' }
  | { kind: 'origin'; origin: string };

let bearerScope: BearerScope = { kind: 'same-origin' };

export function setBearerScope(scope: BearerScope) {
  bearerScope = scope;
}

const bearerAttachesTo = (origin: string): boolean => {
  switch (bearerScope.kind) {
    case 'any-origin':
      return true;
    case 'origin':
      return origin === bearerScope.origin;
    default:
      // same-origin only; the same-origin branch in $fetch handles attachment.
      return false;
  }
};

export function setGlobalHeader(name: string, value: string) {
  globalHeaders.set(name, value);
}

export function deleteGlobalHeader(name: string) {
  globalHeaders.delete(name);
  // The bearer's cross-origin scope is meaningless once the bearer is gone;
  // dropping it here keeps the scope from outliving the token that justified it.
  if (name.toLowerCase() === 'authorization') {
    bearerScope = { kind: 'same-origin' };
  }
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

/**
 * The single origin-aware authenticated browser HTTP primitive.
 *
 * For a SAME-ORIGIN request it merges every global header (bearer/auth),
 * honoring precedence `globalHeaders < Request.headers < RequestInit.headers`,
 * and defaults `credentials: 'same-origin'` (a caller may only tighten to
 * 'omit').
 *
 * For a CROSS-ORIGIN request only the global `Authorization` bearer may ride,
 * and only when its recorded `BearerScope` permits this origin (an explicit
 * `token=` reaches any origin; a `tokenUrl=`-derived token reaches only its
 * issuing origin). Every OTHER global header stays same-origin-only. A Request's
 * own headers and the RequestInit headers still layer on top, and the native
 * credential behavior is left alone.
 *
 * Reads `window.location` for the origin check, so it is main-thread only.
 */
export const $fetch: typeof fetch = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const urlString = input instanceof Request ? input.url : input.toString();
  const requestOrigin = new URL(urlString, window.location.href).origin;
  const sameOrigin = requestOrigin === window.location.origin;

  // Same-origin carries every global header; cross-origin carries ONLY the
  // Authorization bearer, and only when its scope admits this origin. A
  // Request's own headers and the RequestInit headers layer on top (init wins
  // over Request wins over global).
  let headers: Headers;
  if (sameOrigin) {
    headers = new Headers(globalHeaders);
  } else {
    headers = new Headers();
    const authorization = globalHeaders.get('Authorization');
    if (authorization && bearerAttachesTo(requestOrigin)) {
      headers.set('Authorization', authorization);
    }
  }
  if (input instanceof Request) headers = mergeHeaders(headers, input.headers);
  headers = mergeHeaders(headers, init?.headers);

  if (sameOrigin) {
    // Default to same-origin credentials so a cookie-authenticated launch keeps
    // working; the only stricter value ('omit') is honored, never widened.
    const credentials: RequestCredentials =
      init?.credentials === 'omit' ? 'omit' : 'same-origin';
    return fetch(input, { ...init, headers, credentials });
  }
  // Cross-origin: only a scope-permitted Authorization bearer rides (attached
  // above); native credential behavior preserved.
  return fetch(input, { ...init, headers });
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
