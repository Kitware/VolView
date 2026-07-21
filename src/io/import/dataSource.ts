import { Chunk } from '@/src/core/streaming/chunk';
import { Fetcher } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';

/**
 * Represents a URI source with a file name for the downloaded resource.
 */
export type UriSource = {
  type: 'uri';
  uri: string;
  name: string;
  mime?: string;
  fetcher?: Fetcher;
};

/**
 * Represents a user-specified file.
 */
export type FileSource = {
  type: 'file';
  file: File;
  fileType: string;
};

/**
 * Represents an archive member. The parent should exist and be a FileSource.
 */
export type ArchiveSource = {
  type: 'archive';
  path: string;
  parent: FileSource;
};

/**
 * Represents a collection of data sources.
 *
 * This is used for data that is derived from a collection of data sources,
 * e.g. reconstructed DICOM.
 */
export type CollectionSource = {
  type: 'collection';
  sources: DataSource[];
};

/**
 * Represents a data chunk for further processing and import.
 */
export type ChunkSource = {
  type: 'chunk';
  chunk: Chunk;
  mime: string;
};

/**
 * Used to map DICOM volumes back to state file datasets.
 */
export type StateFileLeaf = {
  stateID: string;
};

/**
 * Namespaces a synthesized segment-group leaf's stateID so it can't collide
 * with a save-time dataset id in the shared restore `dataIDMap` — both are
 * small integers minted independently, and a bare `String(dataSourceId)` would
 * let leaf-completion order decide the winner. Transient only; nothing
 * serialized carries the prefix, so old saves restore unchanged.
 */
export const leafStateId = (dataSourceId: number): string =>
  `leaf:${dataSourceId}`;

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
 * Every state-file leaf a data source covers, provenance-first.
 *
 * A leaf on the source (or up its parent chain) names the source itself —
 * one leaf. A leaf-less collection is a MERGED result (a multi-file DICOM
 * volume): every member contributes its own leaf, because the backend's
 * ephemeral compose emits one dataset per FILE while the client merges them
 * into one volume — the restore accounting must map every per-file stateID
 * to that one result (mapping only the first
 * member leaves N-1 datasets "unresolved" and makes segment-group parent
 * binding completion-order luck).
 */
export function findStateFileLeaves(dataSource: DataSource): StateFileLeaf[] {
  let current: DataSource | undefined = dataSource;
  while (current) {
    if (current.stateFileLeaf) return [current.stateFileLeaf];
    current = current.parent;
  }
  if (dataSource.type === 'collection') {
    return dataSource.sources.flatMap(findStateFileLeaves);
  }
  return [];
}

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
