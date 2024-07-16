import { Skip } from '@/src/utils/evaluateChain';
import { getObjectsFromS3, isAmazonS3Uri } from '@/src/io/amazonS3';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { DataSource } from '@/src/io/import/dataSource';

const handleAmazonS3: ImportHandler = async (dataSource) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isAmazonS3Uri(uriSrc.uri)) {
    try {
      const newSources: DataSource[] = [];
      await getObjectsFromS3(uriSrc.uri, (name, url) => {
        newSources.push({
          uriSrc: {
            uri: url,
            name,
          },
          parent: dataSource,
        });
      });
      return asIntermediateResult(newSources);
    } catch (err) {
      throw new Error(`Could not download S3 URI ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return Skip;
};

export default handleAmazonS3;
