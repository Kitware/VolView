import { Skip } from '@/src/utils/evaluateChain';
import { getObjectsFromS3, isAmazonS3Uri } from '@/src/io/amazonS3';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { DataSource } from '@/src/io/import/dataSource';

const handleAmazonS3: ImportHandler = async (dataSource) => {
  if (dataSource.type === 'uri' && isAmazonS3Uri(dataSource.uri)) {
    try {
      const newSources: DataSource[] = [];
      await getObjectsFromS3(dataSource.uri, (name, url) => {
        newSources.push({
          type: 'uri',
          uri: url,
          name,
          parent: dataSource,
        });
      });
      return asIntermediateResult(newSources);
    } catch (err) {
      throw new Error(`Could not download S3 URI ${dataSource.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return Skip;
};

export default handleAmazonS3;
