import { isStateFile } from '@/src/io/state-file';
import { ImportContext, ImportResult } from '@/src/io/import/common';
import { Handler } from '@/src/core/pipeline';
import { DataSource } from '../dataSource';

const EARLIEST_PRIORITY = 0;
const CONFIG_PRIORITY = 1;

export interface PriorityResult {
  dataSource: DataSource;
  priority?: number;
}

type PriorityHandler = Handler<DataSource, PriorityResult, ImportContext>;

/**
 * Assigns priority to JSON files
 * @param src DataSource
 */
export const prioritizeJSON: PriorityHandler = async (src, { done }) => {
  const { fileSrc } = src;
  if (fileSrc?.fileType === 'application/json') {
    // assume config.JSON file
    done({
      dataSource: src,
      priority: CONFIG_PRIORITY,
    });
  }

  return src;
};

/**
 * Assigns first in line priority
 * @param src DataSource
 */
export const earliestPriority: PriorityHandler = async (src, { done }) => {
  return done({
    dataSource: src,
    priority: EARLIEST_PRIORITY,
  });
};

/**
 * Consume state files before extractArchive as .zip file is part of state file check
 * @param src DataSource
 */
export const prioritizeStateFile: PriorityHandler = async (
  dataSource,
  { done }
) => {
  const { fileSrc } = dataSource;
  if (fileSrc && (await isStateFile(fileSrc.file))) {
    done({ dataSource, priority: EARLIEST_PRIORITY });
  }
  return dataSource;
};

type ImportOrPriorityResultHandler = Handler<
  ImportResult | PriorityResult,
  PriorityResult
>;

/**
 * Passthrough PriorityResult
 */
export const priorityIdentity: ImportOrPriorityResultHandler = async (
  dataSource,
  { done }
) => {
  if ('priority' in dataSource) {
    done(dataSource);
  }
  return dataSource;
};

/**
 * Assigns first in line priority
 */
export const earliestPriorityForImportResult: ImportOrPriorityResultHandler =
  async (src, { done }) => {
    return done({
      dataSource: src.dataSource,
      priority: EARLIEST_PRIORITY,
    });
  };
