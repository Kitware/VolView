import { ImportHandler } from '@/src/io/import/common';
import { ensureError } from '@/src/utils';
import { readConfigFile } from '@/src/io/import/configSchema';

/**
 * Reads a JSON file with label config and updates stores.
 * @param dataSource
 * @returns
 */
const handleConfig: ImportHandler = async (dataSource, { done }) => {
  const { fileSrc } = dataSource;
  if (fileSrc?.fileType === 'application/json') {
    try {
      const manifest = await readConfigFile(fileSrc.file);
      // Don't consume JSON if it has no known key
      if (Object.keys(manifest).length === 0) {
        return dataSource;
      }
      return done({ dataSource, config: manifest });
    } catch (err) {
      throw new Error('Failed to parse config file', {
        cause: ensureError(err),
      });
    }
  }
  return dataSource;
};

export default handleConfig;
