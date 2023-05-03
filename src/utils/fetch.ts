import { URL } from 'whatwg-url';

/**
 * Percent is in [0, 1]. If it's Infinity, then the progress is indeterminate.
 */
export type ProgressCallback = (percent: number) => void;

export interface FetchOptions {
  progress?: ProgressCallback;
}

interface URLHandler {
  testURL(url: string): boolean;
  fetchURL(url: string, options?: FetchOptions): Promise<Blob | null>;
}

/**
 * Handles HTTP(S) connections.
 *
 * Progress is approximate, given that data can be sent over gzipped.
 */
const HTTPHandler: URLHandler = {
  testURL: (url) => {
    const { protocol } = new URL(url, window.location.href);
    return protocol === 'http:' || protocol === 'https:';
  },
  fetchURL: async (url, options = {}) => {
    const { progress } = options;

    const response = await fetch(url);
    const contentLength = Number(response.headers.get('content-length')) ?? -1;

    if (!progress) {
      return response.blob();
    }

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
      // eslint-disable-next-line no-await-in-loop
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

/**
 * Handles Google Bucket URLs
 */
const GoogleBucketHandler: URLHandler = {
  testURL: (url) => new URL(url, window.location.href).protocol === 'gs:',
  fetchURL: async (url, options = {}) => {
    const urlComponents = new URL(url, window.location.href);
    const bucket = urlComponents.hostname;
    const path = urlComponents.pathname;
    const httpURL = `https://storage.googleapis.com/${bucket}${path}`;
    return HTTPHandler.fetchURL(httpURL, options);
  },
};

const HANDLERS = [GoogleBucketHandler, HTTPHandler];

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
  options?: FetchOptions
) {
  const handler = HANDLERS.find((h) => h.testURL(url));
  if (!handler) {
    throw new Error(`Cannot find a handler for URL: ${url}`);
  }

  const blob = await handler.fetchURL(url, options);
  if (!blob) {
    throw new Error(`Failed to download ${url}`);
  }

  return new File([blob], name);
}
