import { URL } from 'whatwg-url';
import { fetchJSON } from '../utils/fetch';

export interface GcsObject {
  kind: string;
  id: string;
  selfLink: string;
  mediaLink: string;
  name: string;
  bucket: string;
  size: string;
}

interface GcsObjectListResult {
  kind: string;
  nextPageToken?: string;
  items: GcsObject[];
}

/**
 * Detects `gs://` uri.
 * @param uri
 * @returns
 */
export const isGoogleCloudStorageUri = (uri: string) =>
  new URL(uri).protocol === 'gs:';

/**
 * Extracts bucket and prefix from `gs://` URIs
 * @param uri
 * @returns
 */
export const extractBucketAndPrefixFromGsUri = (uri: string) => {
  const { hostname: bucket, pathname } = new URL(uri);
  // drop the leading forward slash
  const objectName = pathname.replace(/^\//, '');
  return [bucket, objectName] as const;
};

export type ObjectAvailableCallback = (object: GcsObject) => void;

const getObjectEndpoint = (bucket: string) =>
  `https://storage.googleapis.com/storage/v1/b/${bucket}/o`;

async function fetchObjectsWithPagination(
  bucket: string,
  prefix: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) {
  const objects: GcsObject[] = [];

  const paginate = async (nextToken?: string) => {
    const url = new URL(getObjectEndpoint(bucket));
    url.searchParams.append('prefix', prefix);
    url.searchParams.append('maxResults', '1000');
    if (nextToken) {
      url.searchParams.append('pageToken', nextToken);
    }

    const page = await fetchJSON<GcsObjectListResult>(url.toString());
    if (page.kind !== 'storage#objects') {
      throw new Error('GCS did not return a list of objects!');
    }

    objects.push(...page.items);
    page.items.forEach((obj) => onObjectAvailable(obj));

    if (page.nextPageToken) {
      await paginate(page.nextPageToken);
    }
  };

  await paginate();
  return objects;
}

/**
 * Gets all objects from a given gs:// URI.
 *
 * Signed/credentialed requests are currently not supported.
 *
 * This is a simplified entrypoint for GCS. We're not using
 * @google-cloud/storage due to node dependencies. As such, this will most
 * definitely be incomplete (slight API missteps, no retries, etc.) For the
 * purpose of just downloading datasets, it should work just fine.
 *
 * @param gsUri
 * @param onObjectAvailable
 * @returns
 */
export const getObjectsFromGsUri = async (
  gsUri: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) => {
  const [bucketName, objPrefix] = extractBucketAndPrefixFromGsUri(gsUri);
  return fetchObjectsWithPagination(bucketName, objPrefix, onObjectAvailable);
};
