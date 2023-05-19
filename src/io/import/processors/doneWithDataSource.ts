import { ImportHandler } from '@/src/io/import/common';

/**
 * Ends a pipeline execution, returning the final data source.
 * @param dataSource
 * @returns
 */
const doneWithDataSource: ImportHandler = (dataSource, { done }) => {
  return done({ dataSource });
};

export default doneWithDataSource;
