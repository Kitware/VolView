import { FetchCache } from '@/src/utils/fetch';
import { DataSource, FileSource } from '@/src/io/import/dataSource';
import { ARCHIVE_FILE_TYPES } from '@/src/io/mimeTypes';
import { Awaitable } from '@vueuse/core';
import { Config } from '@/src/io/import/configJson';
import { ChainHandler } from '@/src/utils/evaluateChain';
import type { Manifest } from '@/src/io/state-file/schema';
import type { FileEntry } from '@/src/io/types';

export type LoadableResult = {
  type: 'data';
  dataID: string;
  dataSource: DataSource;
  dataType: 'image' | 'model';
};

export type LoadableVolumeResult = LoadableResult & {
  dataType: 'image';
};

export type LoadableModelResult = LoadableResult & {
  dataType: 'model';
};

export type ConfigResult = {
  type: 'config';
  config: Config;
  dataSource: DataSource;
};

export type OkayResult = {
  type: 'ok';
  dataSource: DataSource;
};

export type IntermediateResult = {
  type: 'intermediate';
  dataSources: DataSource[];
};

export type StateFileSetupResult = {
  type: 'stateFileSetup';
  dataSources: DataSource[];
  manifest: Manifest;
  stateFiles: FileEntry[];
};

export type ErrorResult = {
  type: 'error';
  error: Error;
  dataSource: DataSource;
};

export type ImportResult =
  | LoadableResult
  | ConfigResult
  | IntermediateResult
  | StateFileSetupResult
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

export type ImportContext = {
  fetchFileCache?: FetchCache<File>;
  archiveCache?: ArchiveCache;
  dicomDataSources?: DataSource[];
  onCleanup?: (fn: () => void) => void;
  importDataSources?: (
    dataSources: DataSource[]
  ) => Promise<ImportDataSourcesResult[]>;
};

export type ImportHandler = ChainHandler<
  DataSource,
  ImportResult,
  ImportContext
>;

export function isArchive(ds: DataSource): ds is FileSource {
  return ds.type === 'file' && ARCHIVE_FILE_TYPES.has(ds.fileType);
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
