import { URL } from 'whatwg-url';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import { FILE_READERS, getFileMimeType } from '../io';
import { readRemoteManifestFile } from '../io/manifest';
import { ARCHIVE_FILE_TYPES } from '../io/mimeTypes';
import { extractFilesFromZip } from '../io/zip';
import Pipeline, { Handler } from './pipeline';
import { canFetchUrl, fetchFile } from '../utils/fetch';
import { useImageStore } from '../store/datasets-images';
import {
  DatasetFile,
  DatasetPath,
  RemoteDatasetFile,
  isRemote,
  makeLocal,
  makeRemote,
  useFileStore,
} from '../store/datasets-files';
import { useModelStore } from '../store/datasets-models';
import { Maybe } from '../types';
import { dirname } from '../utils/path';
import {
  getObjectsFromGsUri,
  isGoogleCloudStorageUri,
} from '../io/googleCloudStorage';
import { getObjectsFromS3, isAmazonS3Uri } from '../io/amazonS3';

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
 * Represents a source of datasets.
 *
 * If the parent property is set, it represents the DataSource from which this
 * DataSource was derived.
 */
export interface DataSource {
  uriSrc?: UriSource;
  fileSrc?: FileSource;
  archiveSrc?: ArchiveSource;
  parent?: DataSource;
}

export interface ImportResult {
  dataID: string;
  dataSource: DataSource;
  dataType: 'image' | 'model';
}

type ImportHandler = Handler<DataSource, ImportResult>;

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

function isArchive(r: DataSource): r is DataSource & { fileSrc: FileSource } {
  return !!r.fileSrc && ARCHIVE_FILE_TYPES.has(r.fileSrc.fileType);
}

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const retypeFile: ImportHandler = async (dataSource) => {
  let src = dataSource;
  const { fileSrc } = src;
  if (fileSrc && fileSrc.fileType === '') {
    const mime = await getFileMimeType(fileSrc.file);
    if (mime) {
      src = {
        ...src,
        fileSrc: {
          ...fileSrc,
          fileType: mime,
        },
      };
    }
  }
  return src;
};

const importSingleFile: ImportHandler = async (dataSource, { done }) => {
  const { fileSrc } = dataSource;
  if (fileSrc && FILE_READERS.has(fileSrc.fileType)) {
    const reader = FILE_READERS.get(fileSrc.fileType)!;
    const dataObject = await reader(fileSrc.file);

    const fileStore = useFileStore();

    if (dataObject.isA('vtkImageData')) {
      const dataID = useImageStore().addVTKImageData(
        fileSrc.file.name,
        dataObject as vtkImageData
      );
      fileStore.add(dataID, [convertDataSourceToDatasetFile(dataSource)]);

      return done({
        dataID,
        dataSource,
        dataType: 'image',
      });
    }

    if (dataObject.isA('vtkPolyData')) {
      const dataID = useModelStore().addVTKPolyData(
        fileSrc.file.name,
        dataObject as vtkPolyData
      );
      fileStore.add(dataID, [convertDataSourceToDatasetFile(dataSource)]);

      return done({
        dataID,
        dataSource,
        dataType: 'model',
      });
    }

    throw new Error('Data reader did not produce a valid dataset');
  }
  return dataSource;
};

/**
 * Extracts files from an archive
 * @param dataSource
 */
const extractArchive: ImportHandler = async (dataSource, { execute, done }) => {
  if (isArchive(dataSource)) {
    const files = await extractFilesFromZip(dataSource.fileSrc.file);
    files.forEach((entry) => {
      execute({
        fileSrc: {
          file: entry.file,
          fileType: '',
        },
        archiveSrc: {
          path: `${entry.archivePath}/${entry.file.name}`,
        },
        parent: dataSource,
      });
    });
    return done();
  }
  return dataSource;
};

const handleRemoteManifest: ImportHandler = async (
  dataSource,
  { done, execute }
) => {
  const { fileSrc } = dataSource;
  if (fileSrc?.fileType === 'application/json') {
    const remotes: DataSource[] = [];
    try {
      const manifest = await readRemoteManifestFile(fileSrc.file);
      manifest.resources.forEach((res) => {
        remotes.push({
          uriSrc: {
            uri: res.url,
            name: res.name ?? new URL(res.url).pathname,
          },
          parent: dataSource,
        });
      });
    } catch (err) {
      return dataSource;
    }

    remotes.forEach((remote) => {
      execute(remote);
    });
    return done();
  }
  return dataSource;
};

const handleGoogleCloudStorage: ImportHandler = async (
  dataSource,
  { execute, done }
) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isGoogleCloudStorageUri(uriSrc.uri)) {
    await getObjectsFromGsUri(uriSrc.uri, (object) => {
      execute({
        uriSrc: {
          uri: object.mediaLink,
          name: object.name,
        },
        parent: dataSource,
      });
    });
    return done();
  }
  return dataSource;
};

const handleAmazonS3: ImportHandler = async (dataSource, { execute, done }) => {
  const { uriSrc } = dataSource;
  if (uriSrc && isAmazonS3Uri(uriSrc.uri)) {
    await getObjectsFromS3(uriSrc.uri, (name, url) => {
      execute({
        uriSrc: {
          uri: url,
          name,
        },
        parent: dataSource,
      });
    });
    return done();
  }
  return dataSource;
};

const downloadUrl: ImportHandler = async (dataSource, { execute, done }) => {
  const { uriSrc } = dataSource;
  if (uriSrc && canFetchUrl(uriSrc.uri)) {
    const file = await fetchFile(uriSrc.uri, uriSrc.name);
    execute({
      fileSrc: {
        file,
        fileType: '',
      },
      parent: dataSource,
    });
    return done();
  }
  return dataSource;
};

const unhandledResource: ImportHandler = () => {
  throw new Error('Failed to handle a resource');
};

export async function importDataSources(dataSources: DataSource[]) {
  const dicoms: DatasetFile[] = [];
  const importDicomFile: ImportHandler = (dataSource, { done }) => {
    if (dataSource.fileSrc?.fileType === 'application/dicom') {
      dicoms.push(convertDataSourceToDatasetFile(dataSource));
      return done();
    }
    return dataSource;
  };

  const middleware: Array<ImportHandler> = [
    // retyping should be first in the pipeline
    retypeFile,
    handleRemoteManifest,
    handleGoogleCloudStorage,
    handleAmazonS3,
    downloadUrl,
    extractArchive,
    // should be before importSingleFile, since DICOM is more specific
    importDicomFile,
    importSingleFile,
    // catch any unhandled resource
    unhandledResource,
  ];

  const pipeline = new Pipeline(middleware);
  const results = await Promise.all(
    dataSources.map((r) => pipeline.execute(r))
  );

  return {
    dicoms,
    results,
  };
}
