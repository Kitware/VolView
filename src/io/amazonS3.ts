import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { URL } from 'whatwg-url';

/**
 * Detects `s3://` uri.
 * @param uri
 * @returns
 */
export const isAmazonS3Uri = (uri: string) => new URL(uri).protocol === 's3:';

export type ObjectAvailableCallback = (url: string, name: string) => void;

function getObjectPublicUrl(bucket: string, key: string) {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

async function fetchObjectsWithPagination(
  bucket: string,
  prefix: string,
  onObjectAvailable: ObjectAvailableCallback = () => {}
) {
  const client = new S3Client({
    region: 'us-east-1',
    // workaround for sdk's inability to specify anonymous credentials
    signer: { sign: async (request) => request },
  });

  const paginate = async (continuationToken?: string) => {
    const listObjectsCmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    let result;
    try {
      result = await client.send(listObjectsCmd);
    } catch (err) {
      console.error(err);
      throw err;
    }

    if (!result.Contents) {
      throw new Error('S3 returned no objects');
    }

    result.Contents.forEach((obj) => {
      if (!obj.Key) return;
      const name = obj.Key;
      const url = getObjectPublicUrl(bucket, obj.Key);
      onObjectAvailable(name, url);
    });

    if (result.IsTruncated && result.NextContinuationToken) {
      await paginate(result.NextContinuationToken);
    }
  };

  await paginate();
}

/**
 * Extracts bucket and prefix from `s3://` URIs
 * @param uri
 * @returns
 */
export const extractBucketAndPrefixFromS3Uri = (uri: string) => {
  const { hostname: bucket, pathname } = new URL(uri);
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
