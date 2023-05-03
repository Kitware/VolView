import { FetchCache } from '@/src/utils/fetch';
import { DataSource, FileSource } from '@/src/io/import/dataSource';
import { Handler } from '@/src/core/pipeline';
import { ARCHIVE_FILE_TYPES } from '@/src/io/mimeTypes';
import { Awaitable } from '@vueuse/core';

export interface ImportResult {
  dataSource: DataSource;
  dataID?: string;
  dataType?: 'image' | 'dicom' | 'model';
}

export type ArchiveContents = Record<string, File>;
export type ArchiveCache = Map<File, Awaitable<ArchiveContents>>;

export interface ImportContext {
  // Caches URL responses
  fetchFileCache?: FetchCache<File>;
  // Caches archives based on the filename
  archiveCache?: ArchiveCache;
  // Records dicom files
  dicomDataSources?: DataSource[];
}

export type ImportHandler = Handler<DataSource, ImportResult, ImportContext>;

export function isArchive(
  ds: DataSource
): ds is DataSource & { fileSrc: FileSource } {
  return !!ds.fileSrc && ARCHIVE_FILE_TYPES.has(ds.fileSrc.fileType);
}
