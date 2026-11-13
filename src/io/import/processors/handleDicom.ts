import {
  fromBlob,
  fromUrl,
  getDatasetModality,
  IMPLICIT_VR_LITTLE_ENDIAN,
  type DicomLayout,
  type DicomRuntime,
  type Instance,
} from '@/packages/dicom/core';
import { useDicomRuntimeStore } from '@/src/store/dicom-runtime';
import { Skip } from '@/src/utils/evaluateChain';
import {
  ImportHandler,
  asIntermediateResult,
  asOkayResult,
} from '@/src/io/import/common';
import { DataSource, getDataSourceName } from '@/src/io/import/dataSource';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { getErrorDetail } from '@/src/utils';
import { surfaceWarning, useMessageStore } from '@/src/store/messages';
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

const isDicom = (dataSource: DataSource) =>
  (dataSource.type === 'file' &&
    dataSource.fileType === FILE_EXT_TO_MIME.dcm) ||
  (dataSource.type === 'uri' && dataSource.mime === FILE_EXT_TO_MIME.dcm);

// A remote header is read from the stream already opened to sniff its type;
// pixels are fetched again later, so that stream closes after the header.
async function readHeader(dataSource: DataSource, runtime: DicomRuntime) {
  const never = new AbortController().signal;
  if (dataSource.type === 'file')
    return runtime.readInstance(fromBlob(dataSource.file), never);
  if (dataSource.type !== 'uri') throw new Error('Not a DICOM source');
  const source = fromUrl(dataSource.uri, { fetch: runtime.fetch });
  const { fetcher } = dataSource;
  if (!fetcher) return runtime.readInstance(source, never);
  try {
    const header = await runtime.readInstance(
      { read: () => fetcher.getStream() },
      never
    );
    return Object.freeze({ ...header, source });
  } finally {
    fetcher.close();
  }
}

/**
 * Reads a DICOM source's header and hands it on as an instance to import later.
 */
const handleDicom: ImportHandler = async (dataSource) => {
  if (!isDicom(dataSource)) return Skip;

  const name = getDataSourceName(dataSource);
  const { runtime } = useDicomRuntimeStore();

  let instance: Instance;
  try {
    instance = await readHeader(dataSource, runtime);
    reportLayout(name, instance.layout);
  } catch (error) {
    const detail = getErrorDetail(
      error,
      'the file could not be parsed as valid DICOM (check browser console for details)'
    );
    throw new Error(`Failed to read DICOM tags from ${name}: ${detail}`, {
      cause: error,
    });
  }

  const modality = getDatasetModality(instance.dataset);
  if (modality?.startsWith('RT')) {
    useMessageStore().addWarning(
      `DICOM ${modality} modality is not supported. File ${name} will be skipped.`
    );
    return asOkayResult(dataSource);
  }

  // Provenance only needs the URI or file; the instance reads its own bytes.
  const parent = { ...dataSource };
  if (parent.type === 'uri') delete parent.fetcher;

  return asIntermediateResult([{ type: 'dicom', instance, parent }]);
};

export default handleDicom;
