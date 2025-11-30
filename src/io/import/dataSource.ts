import { Chunk } from '@/src/core/streaming/chunk';
import { Fetcher } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

/**
 * Represents a URI source with a file name for the downloaded resource.
 */
export interface UriSource {
  type: 'uri';
  uri: string;
  name: string;
  mime?: string;
  fetcher?: Fetcher;
}

/**
 * Represents a user-specified file.
 */
export interface FileSource {
  type: 'file';
  file: File;
  fileType: string;
}

/**
 * Represents an archive member. The parent should exist and be a FileSource.
 */
export interface ArchiveSource {
  type: 'archive';
  // Full path + filename inside the archive
  path: string;
  parent: FileSource;
}

/**
 * Represents a collection of data sources.
 *
 * This is used for data that is derived from a collection of data sources,
 * e.g. reconstructed DICOM.
 */
export interface CollectionSource {
  type: 'collection';

  sources: DataSource[];
}

/**
 * Represents a data chunk for further processing and import.
 */
export interface ChunkSource {
  type: 'chunk';
  chunk: Chunk;
  mime: string;
}

export interface StateFileLeaf {
  stateID: string;
}

/**
 * Represents a source of data.
 *
 * The parent chain denotes the provenance for each step of the data source resolution.
 */
export type DataSource = {
  parent?: DataSource;
  stateFileLeaf?: StateFileLeaf;
} & (FileSource | UriSource | ArchiveSource | ChunkSource | CollectionSource);

/**
 * Creates a DataSource from a single file.
 * @param file
 * @returns
 */
export const fileToDataSource = (file: File): FileSource => ({
  type: 'file',
  file,
  fileType: file.type,
});

/**
 * Creates a DataSource from a URI.
 * @param uri
 * @returns
 */
export const uriToDataSource = (
  uri: string,
  name: string,
  mime?: string
): UriSource => ({
  type: 'uri',
  uri,
  name,
  mime,
});

/**
 * Creates a DataSource from a file downloaded from a URI.
 * @param uri
 * @returns
 */
export const remoteFileToDataSource = (
  file: File,
  uri: string
): DataSource => ({
  ...fileToDataSource(file),
  parent: uriToDataSource(uri, file.name),
});

/**
 * Determines if a data source has remote provenance.
 * @param ds
 * @returns
 */
export function isRemoteDataSource(ds: DataSource | undefined): boolean {
  if (!ds) return false;
  return ds.type === 'uri' || isRemoteDataSource(ds.parent);
}

/**
 * Gets the name associated with a data source, if any.
 * @param ds
 */
export function getDataSourceName(ds: Maybe<DataSource>): Maybe<string> {
  if (!ds) return null;

  if (ds.type === 'file') return ds.file.name;
  if (ds.type === 'uri') return ds.name;
  if (ds.type === 'collection' && ds.sources.length) {
    const { sources } = ds;
    const [first] = sources;
    const more = sources.length > 1 ? ` (+${sources.length - 1} more)` : '';
    return `${getDataSourceName(first)}${more}`;
  }

  return getDataSourceName(ds.parent);
}
