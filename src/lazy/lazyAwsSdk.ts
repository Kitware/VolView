export { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
export const config = {
  autoChunk: [/@aws-(sdk|crypto)/],
};
