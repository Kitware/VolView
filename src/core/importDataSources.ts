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
  DatasetUrl,
  isRemote,
  makeLocal,
  useFileStore,
} from '../store/datasets-files';
import { useModelStore } from '../store/datasets-models';
import { Maybe } from '../types';

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
 * data source that has a FileSource of the containing archive.
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
 * This helper converts a more flexible DataSource into a simpler DatasetFile.
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

  // remote file case
  const remoteDataSource = provenance.find((ds) => ds.uriSrc);
  if (remoteDataSource) {
    const archiveSrc = provenance.find((ds) => ds.archiveSrc)?.archiveSrc;
    return {
      url: remoteDataSource.uriSrc!.uri as DatasetUrl,
      remoteFilename: remoteDataSource.uriSrc!.name,
      file: fileDataSource.fileSrc!.file,
      ...(archiveSrc
        ? {
            archivePath: archiveSrc.path
              .split('/')
              .slice(0, -1)
              .join('/') as DatasetPath,
          }
        : {}),
    };
  }

  // local file case
  return makeLocal(fileDataSource.fileSrc!.file);
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

  return {
    fileSrc: {
      file: dataset.file,
      fileType: '',
    },
    parent,
  };
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
