import { Skip } from '@/src/utils/evaluateChain';
import StreamingByteReader from '@/src/core/streaming/streamingByteReader';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
import { getFileMimeFromMagicStream } from '@/src/io/magic';
import { getMimeTypeFromFilename } from '@/src/io/io';
import { asCoroutine } from '@/src/utils';

const DoneSignal = Symbol('DoneSignal');

// MIME types that don't need magic byte detection
const TRUSTED_MIME_TYPES = new Set(['application/json', 'application/dicom']);

function detectStreamType(stream: ReadableStream) {
  return new Promise<string>((resolve, reject) => {
    const reader = new StreamingByteReader();
    const consume = asCoroutine(getFileMimeFromMagicStream(reader));

    const writableStream = new WritableStream({
      write(chunk) {
        const result = consume(chunk);
        if (result.done) {
          const mime = result.value;
          resolve(mime ?? '');
          throw DoneSignal;
        }
      },
    });

    stream
      .pipeTo(writableStream)
      .then(() => {
        resolve('');
      })
      .catch((err) => {
        if (err !== DoneSignal) {
          reject(err);
        }
      });
  });
}

const updateUriType: ImportHandler = async (dataSource) => {
  if (dataSource.type !== 'uri' || !dataSource?.fetcher) {
    return Skip;
  }

  if (dataSource.mime !== undefined) {
    return Skip;
  }

  // First, try to determine MIME type from filename extension
  const mimeFromFilename = getMimeTypeFromFilename(dataSource.name);
  if (mimeFromFilename) {
    // Prioritize extension-based MIME type over server-provided type
    return asIntermediateResult([
      {
        ...dataSource,
        mime: mimeFromFilename,
      },
    ]);
  }

  const { fetcher } = dataSource;

  await fetcher.connect();

  // First try to use the Content-Type header from the HTTP response
  let mime = fetcher.contentType || '';

  // Extract just the MIME type without charset or other parameters
  if (mime.includes(';')) {
    mime = mime.split(';')[0].trim();
  }

  // Always get the stream to ensure it's properly teed for later use
  const stream = fetcher.getStream();

  // Use magic detection unless we trust the MIME type
  if (!TRUSTED_MIME_TYPES.has(mime)) {
    mime = await detectStreamType(stream);
  }

  const streamDataSource = {
    ...dataSource,
    mime,
  };

  return asIntermediateResult([streamDataSource]);
};

export default updateUriType;
