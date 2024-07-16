import { Skip } from '@/src/utils/evaluateChain';
import {
  getObjectsFromGsUri,
  isGoogleCloudStorageUri,
} from '@/src/io/googleCloudStorage';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { DataSource } from '@/src/io/import/dataSource';

const handleGoogleCloudStorage: ImportHandler = async (dataSource) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isGoogleCloudStorageUri(uriSrc.uri)) {
    try {
      const newSources: DataSource[] = [];
      await getObjectsFromGsUri(uriSrc.uri, (object) => {
        newSources.push({
          uriSrc: {
            uri: object.mediaLink,
            name: object.name,
          },
          parent: dataSource,
        });
      });
      return asIntermediateResult(newSources);
    } catch (err) {
      throw new Error(`Could not download GCS URI ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return Skip;
};

export default handleGoogleCloudStorage;
