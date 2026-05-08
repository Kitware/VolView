import { parseUrl } from '@/src/utils/url';

/**
 * Detects `s3://` uri.
 * @param uri
 * @returns
 */
export const isAmazonS3Uri = (uri: string) =>
  parseUrl(uri, window.location.origin).protocol === 's3:';

export type ObjectAvailableCallback = (name: string, url: string) => void;

// Percent-encode each path segment so keys containing reserved URI chars
// (`?`, `#`, space, `+`, …) round-trip correctly. Slashes are preserved.
const encodeS3Key = (key: string) =>
  key.split('/').map(encodeURIComponent).join('/');

const getObjectPublicUrl = (bucket: string, key: string) =>
  `https://${bucket}.s3.amazonaws.com/${encodeS3Key(key)}`;

const buildListUrl = (
  bucket: string,
  prefix: string,
  continuationToken?: string
) => {
  const u = new URL(`https://${bucket}.s3.amazonaws.com/`);
  u.searchParams.set('list-type', '2');
  u.searchParams.set('prefix', prefix);
  u.searchParams.set('max-keys', '1000');
  if (continuationToken)
    u.searchParams.set('continuation-token', continuationToken);
  return u.toString();
};

type ListPage = {
  keys: string[];
  nextContinuationToken: string | null;
};

const getChildText = (el: Element, tag: string) =>
  el.getElementsByTagName(tag)[0]?.textContent ?? null;

const parseListResponse = (xmlText: string): ListPage => {
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const root = xml.documentElement;
  if (root.tagName === 'parsererror') {
    throw new Error('S3 ListObjectsV2: invalid XML response');
  }
  if (root.tagName === 'Error') {
    throw new Error(
      `S3 ListObjectsV2: ${getChildText(root, 'Code') ?? 'Error'}: ${getChildText(root, 'Message') ?? ''}`
    );
  }
  if (root.tagName !== 'ListBucketResult') {
    throw new Error(
      `S3 ListObjectsV2: unexpected response root <${root.tagName}>`
    );
  }
  const keys = Array.from(root.getElementsByTagName('Contents'))
    .map((c) => getChildText(c, 'Key'))
    .filter((k): k is string => !!k);
  const isTruncated = getChildText(root, 'IsTruncated') === 'true';
  return {
    keys,
    nextContinuationToken: isTruncated
      ? getChildText(root, 'NextContinuationToken')
      : null,
  };
};

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;
const MAX_BACKOFF_MS = 2000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const backoffDelay = (attempt: number) => {
  const exp = Math.min(2 ** (attempt - 1) * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
  return exp + Math.random() * exp * 0.3;
};

const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const listObjectsV2Page = async (
  bucket: string,
  prefix: string,
  continuationToken?: string
): Promise<ListPage> => {
  const res = await fetchWithRetry(
    buildListUrl(bucket, prefix, continuationToken)
  );
  if (!res.ok) {
    throw new Error(`S3 ListObjectsV2 ${bucket}: HTTP ${res.status}`);
  }
  return parseListResponse(await res.text());
};

const fetchObjectsWithPagination = async (
  bucket: string,
  prefix: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) => {
  let continuationToken: string | undefined;
  let total = 0;
  do {
    const page = await listObjectsV2Page(bucket, prefix, continuationToken);
    page.keys.forEach((key) => {
      onObjectAvailable(key, getObjectPublicUrl(bucket, key));
    });
    total += page.keys.length;
    continuationToken = page.nextContinuationToken ?? undefined;
  } while (continuationToken);

  if (total === 0) {
    throw new Error('S3 returned no objects');
  }
};

/**
 * Extracts bucket and prefix from `s3://` URIs
 * @param uri
 * @returns
 */
export const extractBucketAndPrefixFromS3Uri = (uri: string) => {
  const { hostname: bucket, pathname } = parseUrl(uri);
  // drop the leading forward slash
  const objectName = pathname.replace(/^\//, '');
  return [bucket, objectName] as const;
};

/**
 * Gets all objects from an s3:// URI.
 *
 * Signed/credentialed requests are currently not supported.
 *
 * @param s3Uri
 */
export const getObjectsFromS3 = async (
  s3Uri: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) => {
  const [bucket, objPrefix] = extractBucketAndPrefixFromS3Uri(s3Uri);
  await fetchObjectsWithPagination(bucket, objPrefix, onObjectAvailable);
};
