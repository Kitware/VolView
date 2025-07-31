import { DataSource } from '@/src/io/import/dataSource';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { readRemoteManifestFile } from '@/src/io/manifest';
import { Skip } from '@/src/utils/evaluateChain';
import { ZodError } from 'zod';

/**
 * Reads a JSON file that conforms to the remote manifest spec.
 * @param dataSource
 * @returns
 */
const handleRemoteManifest: ImportHandler = async (dataSource) => {
  if (
    dataSource.type !== 'file' ||
    dataSource.fileType !== 'application/json'
  ) {
    return Skip;
  }

  try {
    const remotes: DataSource[] = [];
    const manifest = await readRemoteManifestFile(dataSource.file);
    manifest.resources.forEach((res) => {
      remotes.push({
        type: 'uri',
        uri: res.url,
        name: res.name ?? new URL(res.url, window.location.origin).pathname,
        parent: dataSource,
      });
    });

    return asIntermediateResult(remotes);
  } catch (err) {
    if (err instanceof ZodError) return Skip;
    throw err;
  }
};

export default handleRemoteManifest;
