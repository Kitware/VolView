import { parseUrl } from '@/src/utils/url';
// AWS SDK temporarily disabled for monorepo integration
// import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

/**
 * Detects `s3://` uri.
 * @param uri
 * @returns
 */
export const isAmazonS3Uri = (uri: string) =>
  parseUrl(uri, window.location.origin).protocol === 's3:';

export type ObjectAvailableCallback = (url: string, name: string) => void;

function getObjectPublicUrl(bucket: string, key: string) {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

async function fetchObjectsWithPagination(
  bucket: string,
  prefix: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) {
  // AWS S3 functionality temporarily disabled for monorepo integration
  console.warn('AWS S3 functionality is temporarily disabled');
  throw new Error('AWS S3 functionality is temporarily disabled for monorepo integration');
}

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
  // AWS S3 functionality temporarily disabled for monorepo integration
  console.warn('AWS S3 functionality is temporarily disabled');
  throw new Error('AWS S3 functionality is temporarily disabled for monorepo integration');
};
