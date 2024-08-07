import { Skip } from '@/src/utils/evaluateChain';
import StreamingByteReader from '@/src/core/streaming/streamingByteReader';
import { ImportHandler, asIntermediateResult } from '@/src/io/import/common';
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
  if (dataSource.type !== 'uri' || !dataSource?.fetcher) {
    return Skip;
  }

  if (dataSource.mime !== undefined) {
    return Skip;
  }

  const { fetcher } = dataSource;

  await fetcher.connect();
  const stream = fetcher.getStream();
  const mime = await detectStreamType(stream);

  const streamDataSource = {
    ...dataSource,
    mime,
  };

  return asIntermediateResult([streamDataSource]);
};

export default updateUriType;
