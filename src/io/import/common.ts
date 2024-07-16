import { FetchCache } from '@/src/utils/fetch';
import { DataSource, FileSource } from '@/src/io/import/dataSource';
import { ARCHIVE_FILE_TYPES } from '@/src/io/mimeTypes';
import { Awaitable } from '@vueuse/core';
import { Config } from '@/src/io/import/configJson';
import { ChainHandler } from '@/src/utils/evaluateChain';

export interface LoadableResult {
  type: 'data';
  dataID: string;
  dataSource: DataSource;
  dataType: 'image' | 'model';
}

export interface LoadableVolumeResult extends LoadableResult {
  dataType: 'image';
}

export interface LoadableModelResult extends LoadableResult {
  dataType: 'model';
}

export interface ConfigResult {
  type: 'config';
  config: Config;
  dataSource: DataSource;
}

export interface OkayResult {
  type: 'ok';
  dataSource: DataSource;
}

export interface IntermediateResult {
  type: 'intermediate';
  dataSources: DataSource[];
}

export interface ErrorResult {
  type: 'error';
  error: Error;
  dataSource: DataSource;
}

export type ImportResult =
  | LoadableResult
  | ConfigResult
  | IntermediateResult
  | OkayResult
  | ErrorResult;

export type ImportDataSourcesResult =
  | ConfigResult
  | LoadableResult
  | OkayResult
  | ErrorResult;

export const asLoadableResult = (
  dataID: string,
  dataSource: DataSource,
  dataType: 'image' | 'model'
): LoadableResult => ({
  type: 'data',
  dataID,
  dataSource,
  dataType,
});

export const asIntermediateResult = (
  dataSources: DataSource[]
): IntermediateResult => ({
  type: 'intermediate',
  dataSources,
});

export const asConfigResult = (
  dataSource: DataSource,
  config: Config
): ConfigResult => ({
  type: 'config',
  dataSource,
  config,
});

export const asErrorResult = (
  error: Error,
  dataSource: DataSource
): ErrorResult => ({
  type: 'error',
  error,
  dataSource,
});

export const asOkayResult = (dataSource: DataSource): OkayResult => ({
  type: 'ok',
  dataSource,
});

export type ArchiveContents = Record<string, File>;
export type ArchiveCache = Map<File, Awaitable<ArchiveContents>>;

export interface ImportContext {
  // Caches URL responses
  fetchFileCache?: FetchCache<File>;
  // Caches archives. ArchiveFile -> { [archivePath]: File }
  archiveCache?: ArchiveCache;
  // Records dicom files
  dicomDataSources?: DataSource[];
  onCleanup?: (fn: () => void) => void;
  /**
   * A reference to importDataSources for nested imports.
   */
  importDataSources?: (
    dataSources: DataSource[]
  ) => Promise<ImportDataSourcesResult[]>;
}

export type ImportHandler = ChainHandler<
  DataSource,
  ImportResult,
  ImportContext
>;

export function isArchive(
  ds: DataSource
): ds is DataSource & { fileSrc: FileSource } {
  return !!ds.fileSrc && ARCHIVE_FILE_TYPES.has(ds.fileSrc.fileType);
}

export function isLoadableResult(
  importResult: ImportResult
): importResult is LoadableResult {
  return importResult.type === 'data';
}

export function isVolumeResult(
  importResult: ImportResult
): importResult is LoadableVolumeResult {
  return isLoadableResult(importResult) && importResult.dataType === 'image';
}

export function isConfigResult(
  importResult: ImportResult
): importResult is ConfigResult {
  return importResult.type === 'config';
}
