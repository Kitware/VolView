import {
  getObjectsFromGsUri,
  isGoogleCloudStorageUri,
} from '@/src/io/googleCloudStorage';
import { ImportHandler } from '@/src/io/import/common';

const handleGoogleCloudStorage: ImportHandler = async (
  dataSource,
  { execute, done }
) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isGoogleCloudStorageUri(uriSrc.uri)) {
    try {
      await getObjectsFromGsUri(uriSrc.uri, (object) => {
        execute({
          uriSrc: {
            uri: object.mediaLink,
            name: object.name,
          },
          parent: dataSource,
        });
      });
      return done();
    } catch (err) {
      throw new Error(`Could not download GCS URI ${uriSrc.uri}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  return dataSource;
};

export default handleGoogleCloudStorage;
