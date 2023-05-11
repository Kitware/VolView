import { getObjectsFromS3, isAmazonS3Uri } from '@/src/io/amazonS3';
import { ImportHandler } from '@/src/io/import/common';

const handleAmazonS3: ImportHandler = async (dataSource, { execute, done }) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isAmazonS3Uri(uriSrc.uri)) {
    try {
      await getObjectsFromS3(uriSrc.uri, (name, url) => {
        execute({
          uriSrc: {
            uri: url,
            name,
          },
          parent: dataSource,
        });
      });
      return done();
    } catch (err) {
      throw new Error(`Could not download S3 URI ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return dataSource;
};

export default handleAmazonS3;
