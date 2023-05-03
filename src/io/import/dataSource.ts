import {
  DatasetFile,
  DatasetPath,
  RemoteDatasetFile,
  isRemote,
  makeLocal,
  makeRemote,
} from '@/src/store/datasets-files';
import { Maybe } from '@/src/types';
import { dirname } from '@/src/utils/path';

/**
 * Represents a URI source with a file name for the downloaded resource.
 */
export interface UriSource {
  uri: string;
  name: string;
}

/**
 * Represents a user-specified file.
 */
export interface FileSource {
  file: File;
  fileType: string;
}

/**
 * If an archive source is specified, then it is assumed that the data source
 * has a FileSource (representing the file inside the archive), and a parent
 * data source that refers to the archive.
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
 * Represents a source of datasets.
 *
 * If the parent property is set, it represents the DataSource from which this
 * DataSource was derived.
 */
export interface DataSource {
  uriSrc?: UriSource;
  fileSrc?: FileSource;
  archiveSrc?: ArchiveSource;
  dicomSrc?: DicomSource;
  parent?: DataSource;
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
 * This helper converts a more flexible DataSource into a simpler DatasetFile.
 *
 * This will create a new File object with the type derived from
 * DataSource.fileSrc.fileType.
 * @param source
 */
export function convertDataSourceToDatasetFile(
  source: DataSource
): DatasetFile {
  const provenance = flattenDataSourceHierarchy(source);
  const fileDataSource = provenance.find((ds) => ds.fileSrc?.file);
  if (!fileDataSource) {
    throw new Error('DataSource has no file source!');
  }

  // local file case
  const { file, fileType } = fileDataSource.fileSrc!;
  let dataset: DatasetFile = makeLocal(
    new File([file], file.name, { type: fileType })
  );

  // remote file case
  const remoteDataSource = provenance.find((ds) => ds.uriSrc);
  if (remoteDataSource) {
    dataset = makeRemote(remoteDataSource.uriSrc!.uri, dataset);
    // if from archive, then the remoteFilename is the parent archive name
    const parentName = getDataSourceName(fileDataSource.parent);
    if (fileDataSource.archiveSrc && parentName) {
      (dataset as RemoteDatasetFile).remoteFilename = parentName;
    }
  }

  // add archive information
  if (fileDataSource.archiveSrc) {
    dataset = {
      ...dataset,
      archivePath: dirname(fileDataSource.archiveSrc.path) as DatasetPath,
    };
  }

  return dataset;
}

/**
 * Converts a DatasetFile to a DataSource.
 *
 * This is an imperfect conversion, since DatasetFile contains less information
 * (e.g. hierarchical provenance info).
 * @param dataset
 * @returns
 */
export function convertDatasetFileToDataSource(
  dataset: DatasetFile,
  options?: {
    forceRemoteOnly: boolean;
  }
): DataSource {
  const forceRemoteOnly = options?.forceRemoteOnly ?? false;
  let parent: DataSource | undefined;

  if (isRemote(dataset)) {
    parent = {
      uriSrc: {
        uri: dataset.url,
        name: dataset.remoteFilename,
      },
    };

    if (forceRemoteOnly) {
      return parent;
    }
  }

  const source: DataSource = {
    fileSrc: {
      file: dataset.file,
      fileType: dataset.file.type,
    },
    parent,
  };

  if ('archivePath' in dataset && parent) {
    source.archiveSrc = {
      // assumes the archive name is the same as the file name
      path: `${dataset.archivePath}/${source.fileSrc!.file.name}`,
    };
  }

  return source;
}
