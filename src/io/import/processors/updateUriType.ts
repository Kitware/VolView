import StreamingByteReader from '@/src/core/streaming/streamingByteReader';
import { ImportHandler } from '@/src/io/import/common';
import { getFileMimeFromMagicStream } from '@/src/io/magic';
import { asCoroutine } from '@/src/utils';

const DoneSignal = Symbol('DoneSignal');

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
  const { fileSrc, uriSrc } = dataSource;
  if (fileSrc || !uriSrc?.fetcher) {
    return dataSource;
  }

  const { fetcher } = uriSrc;

  await fetcher.connect();
  const stream = fetcher.getStream();
  const mime = await detectStreamType(stream);

  const streamDataSource = {
    ...dataSource,
    uriSrc: {
      ...uriSrc,
      mime,
    },
  };

  return streamDataSource;
};

export default updateUriType;
