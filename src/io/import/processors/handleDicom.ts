import { Skip } from '@/src/utils/evaluateChain';
import { blobFetcher } from '@/src/core/streaming/blobFetcher';
import { CachedStreamFetcher } from '@/src/core/streaming/cachedStreamFetcher';
import { Chunk } from '@/src/core/streaming/chunk';
import { DicomDataLoader } from '@/src/core/streaming/dicom/dicomDataLoader';
import { DicomMetaLoader } from '@/src/core/streaming/dicom/dicomMetaLoader';
import { getRequestPool } from '@/src/core/streaming/requestPool';
import {
  ImportHandler,
  asIntermediateResult,
  asOkayResult,
} from '@/src/io/import/common';
import { DataSource, getDataSourceName } from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { getErrorDetail } from '@/src/utils';
import { Tags } from '@/src/core/dicomTags';
import { surfaceWarning, useMessageStore } from '@/src/store/messages';
import {
  IMPLICIT_VR_LITTLE_ENDIAN,
  type DicomLayout,
} from '@/src/io/dicomLayout';
import { Maybe } from '@/src/types';

// A folder of files that all depart from Part 10 the same way would raise one
// notice per file, so each departure is reported once per session.
const noticed = new WeakMap<object, Set<string>>();

const noticeOnce = (key: string, title: string, details: string) => {
  const store = useMessageStore();
  const seen = noticed.get(store) ?? new Set<string>();
  noticed.set(store, seen);
  if (seen.has(key)) return;
  seen.add(key);
  surfaceWarning(title, details);
};

/**
 * A data set with no file meta information names no transfer syntax, so the
 * one it was read in is an assumption the user should hear about.
 */
const reportLayout = (name: Maybe<string>, layout: Maybe<DicomLayout>) => {
  if (!layout || layout.fileMeta) return;
  const syntax =
    layout.transferSyntaxUid === IMPLICIT_VR_LITTLE_ENDIAN
      ? 'Implicit'
      : 'Explicit';
  noticeOnce(
    `assumed-syntax:${syntax}`,
    'A DICOM file has no file meta information',
    `${name ?? 'A file'} has no preamble and no file meta information, so it was read ` +
      `as ${syntax} VR Little Endian. Other files that open the same way ` +
      'were read the same way without further notice.'
  );
};

const dicomFetcher = (dataSource: DataSource) => {
  if (
    dataSource.type === 'file' &&
    dataSource.fileType === FILE_EXT_TO_MIME.dcm
  )
    return blobFetcher(dataSource.file);

  if (dataSource.type === 'uri' && dataSource.mime === FILE_EXT_TO_MIME.dcm)
    return (
      dataSource.fetcher ??
      new CachedStreamFetcher(dataSource.uri, {
        fetch: (...args) => getRequestPool().fetch(...args),
      })
    );

  return null;
};

/**
 * Reads a DICOM source's header and hands it on as a chunk to import later.
 */
const handleDicom: ImportHandler = async (dataSource) => {
  const fetcher = dicomFetcher(dataSource);
  if (!fetcher) return Skip;

  const name = getDataSourceName(dataSource);
  const metaLoader = new DicomMetaLoader(fetcher);
  const chunk = new Chunk({
    metaLoader,
    dataLoader: new DicomDataLoader(fetcher),
  });

  try {
    await chunk.loadMeta();
    reportLayout(name, metaLoader.fileLayout);
  } catch (error) {
    const detail = getErrorDetail(
      error,
      'the file could not be parsed as valid DICOM (check browser console for details)'
    );
    throw new Error(`Failed to read DICOM tags from ${name}: ${detail}`, {
      cause: error,
    });
  }

  const modality = new Map(chunk.metadata ?? []).get(Tags.Modality)?.trim();
  if (modality?.startsWith('RT')) {
    useMessageStore().addWarning(
      `DICOM ${modality} modality is not supported. File ${name} will be skipped.`
    );
    return asOkayResult(dataSource);
  }

  return asIntermediateResult([
    {
      type: 'chunk',
      chunk,
      mime: FILE_EXT_TO_MIME.dcm,
      parent: dataSource,
    },
  ]);
};

export default handleDicom;
