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
  }
  return dataSource;
};

export default handleGoogleCloudStorage;
