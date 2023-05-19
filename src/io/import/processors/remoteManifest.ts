import { DataSource } from '@/src/io/import/dataSource';
import { ImportHandler } from '@/src/io/import/common';
import { readRemoteManifestFile } from '@src/io/manifest';

/**
 * Reads a JSON file that conforms to the remote manifest spec.
 * @param dataSource
 * @returns
 */
const handleRemoteManifest: ImportHandler = async (
  dataSource,
  { done, execute }
) => {
  const { fileSrc } = dataSource;
  if (fileSrc?.fileType === 'application/json') {
    const remotes: DataSource[] = [];
    try {
      const manifest = await readRemoteManifestFile(fileSrc.file);
      manifest.resources.forEach((res) => {
        remotes.push({
          uriSrc: {
            uri: res.url,
            name: res.name ?? new URL(res.url).pathname,
          },
          parent: dataSource,
        });
      });
    } catch (err) {
      return dataSource;
    }

    remotes.forEach((remote) => {
      execute(remote);
    });
    return done();
  }
  return dataSource;
};

export default handleRemoteManifest;
