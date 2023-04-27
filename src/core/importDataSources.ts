import { URL } from 'whatwg-url';
import { getFileMimeType } from '../io';
import { readRemoteManifestFile } from '../io/manifest';
import { ARCHIVE_FILE_TYPES } from '../io/mimeTypes';
import { extractFilesFromZip } from '../io/zip';
import Pipeline, { Handler } from './pipeline';
import { canFetchUrl, fetchFile } from '../utils/fetch';

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
 * Cases to handle:
 *   associated dataset file is part of a (potentially nested) remote archive
 */
export interface DataSource {
  uriSrc?: UriSource;
  fileSrc?: FileSource;
  archiveSrc?: ArchiveSource;
  parent?: DataSource;
}

function isArchive(r: DataSource): r is DataSource & { fileSrc: FileSource } {
  return !!r.fileSrc && ARCHIVE_FILE_TYPES.has(r.fileSrc.fileType);
}

/**
 * Transforms a file data source to have a mime type
 * @param dataSource
 */
const retypeFile: Handler<DataSource> = async (dataSource, { next }) => {
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
  next(src);
};

const importSingleFile: Handler<DataSource> = (dataSource, { next }) => {
  if (dataSource.fileSrc) {
    // pass to readers
    console.log('importing single file', dataSource);
  } else {
    next();
  }
};

const importDicomFile: Handler<DataSource> = (dataSource, { next }) => {
  if (dataSource.fileSrc?.fileType === 'application/dicom') {
    // pass to dicom store
    console.log('importing dicom', dataSource);
  } else {
    next();
  }
};

/**
 * Extracts files from an archive
 * @param dataSource
 */
const extractArchive: Handler<DataSource> = async (
  dataSource,
  { next, execute }
) => {
  if (isArchive(dataSource)) {
    const files = await extractFilesFromZip(dataSource.fileSrc.file);
    files.forEach((entry) => {
      execute({
        fileSrc: {
          file: entry.file,
          fileType: '',
        },
        archiveSrc: {
          path: entry.archivePath,
        },
        parent: dataSource,
      });
    });
  } else {
    next();
  }
};

const handleRemoteManifest: Handler<DataSource> = async (
  dataSource,
  { next, execute }
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
      next();
      return;
    }

    remotes.forEach((remote) => {
      execute(remote);
    });
  } else {
    next();
  }
};

const downloadUrl: Handler<DataSource> = async (
  dataSource,
  { next, execute }
) => {
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
  } else {
    next();
  }
};

const unhandledResource: Handler<DataSource> = () => {
  throw new Error('Failed to handle a resource');
};

export async function importDataSources(dataSources: DataSource[]) {
  const middleware = [
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
  return results;
}
