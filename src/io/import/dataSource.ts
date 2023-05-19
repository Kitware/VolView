import { Maybe } from '@/src/types';

/**
 * Represents a URI source with a file name for the downloaded resource.
 *
 * This can optionally be paired with a FileSource, indicating that the
 * FileSource is a remote FileSource.
 */
export interface UriSource {
  uri: string;
  name: string;
}

/**
 * Represents a user-specified file.
 *
 * This can optionally be paired with an ArchiveSource.
 */
export interface FileSource {
  file: File;
  fileType: string;
}

/**
 * If an archive source is specified, then it is assumed that the data source
 * has a FileSource (representing the file inside the archive), and a parent
 * data source with a FileSource that refers to the archive.
 */
export interface ArchiveSource {
  // Full path + filename inside the archive
  path: string;
}

/**
 * Used to collect DICOM file data sources.
 *
 * This is currently used for consolidating multiple DICOM files into one
 * DataSource for error stack trace purposes.
 */
export interface DicomSource {
  // eslint-disable-next-line no-use-before-define
  sources: DataSource[];
}

/**
 * Represents a source of data.
 *
 * If the parent property is set, it represents the DataSource from which this
 * DataSource was derived.
 *
 * Examples:
 * - { uriSrc }: a file that has yet to be downloaded.
 * - { fileSrc, parent: { uriSrc } }: a file with URI provenance info.
 * - { fileSrc, archiveSrc, parent }: a file originating from an archive.
 * - { dicomSrc }: a list of dicom data sources.
 */
export interface DataSource {
  fileSrc?: FileSource;
  uriSrc?: UriSource;
  archiveSrc?: ArchiveSource;
  dicomSrc?: DicomSource;
  parent?: DataSource;
}

export type DataSourceWithFile = DataSource & { fileSrc: FileSource };

/**
 * Creates a DataSource from a single file.
 * @param file
 * @returns
 */
export const fileToDataSource = (file: File): DataSource => ({
  fileSrc: {
    file,
    fileType: file.type,
  },
});

/**
 * Creates a DataSource from a URI.
 * @param uri
 * @returns
 */
export const uriToDataSource = (uri: string, name: string): DataSource => ({
  uriSrc: {
    uri,
    name,
  },
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
  ...uriToDataSource(uri, file.name),
});

/**
 * Determines if a data source has remote provenance.
 * @param ds
 * @returns
 */
export function isRemoteDataSource(ds: DataSource): boolean {
  return !!ds.uriSrc || (!!ds.parent && isRemoteDataSource(ds.parent));
}

/**
 * Flattens a data source hierarchy, ordered by descendant first.
 *
 * For a given data source `ds`, `ds` is the descendant and `ds.parent` is the
 * ancestor.
 *
 * @param ds
 * @returns
 */
export function flattenDataSourceHierarchy(ds: DataSource): DataSource[] {
  const sources: DataSource[] = [];
  let cur: Maybe<DataSource> = ds;
  while (cur) {
    sources.push(cur);
    cur = cur.parent;
  }
  return sources;
}

/**
 * Gets the name associated with a data source, if any.
 * @param ds
 */
export function getDataSourceName(ds: Maybe<DataSource>): Maybe<string> {
  if (ds?.fileSrc) {
    return ds.fileSrc.file.name;
  }

  if (ds?.uriSrc) {
    return ds.uriSrc.name;
  }

  if (ds?.dicomSrc?.sources.length) {
    const { sources } = ds.dicomSrc;
    const [first] = sources;
    const more = sources.length > 1 ? ` (+${sources.length - 1} more)` : '';
    return `${getDataSourceName(first)}${more}`;
  }

  return null;
}

/**
 * Serializes a data source into a JSON formattable object.
 *
 * FileSources are stripped, as they cannot be properly serialized. This
 * includes the fileType property, which should be inferred when retyping the
 * file.
 * @param ds
 */
export function serializeDataSource(ds: DataSource) {
  const output = { ...ds };
  delete output.fileSrc;
  if (output.parent) {
    output.parent = serializeDataSource(output.parent);
  }
  return output;
}
