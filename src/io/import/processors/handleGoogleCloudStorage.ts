import { Skip } from '@/src/utils/evaluateChain';
import {
  getObjectsFromGsUri,
  isGoogleCloudStorageUri,
} from '@/src/io/googleCloudStorage';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { DataSource } from '@/src/io/import/dataSource';

const handleGoogleCloudStorage: ImportHandler = async (dataSource) => {
  if (dataSource.type === 'uri' && isGoogleCloudStorageUri(dataSource.uri)) {
    try {
      const newSources: DataSource[] = [];
      await getObjectsFromGsUri(dataSource.uri, (object) => {
        newSources.push({
          type: 'uri',
          uri: object.mediaLink,
          name: object.name,
          parent: dataSource,
        });
      });
      return asIntermediateResult(newSources);
    } catch (err) {
      throw new Error(`Could not download GCS URI ${dataSource.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return Skip;
};

export default handleGoogleCloudStorage;
