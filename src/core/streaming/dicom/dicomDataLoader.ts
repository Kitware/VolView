import { DataLoader, Fetcher } from '@/src/core/streaming/types';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { Maybe } from '@/src/types';

export class DicomDataLoader implements DataLoader {
  public data: Maybe<Blob>;
  private fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async load() {
    await this.fetcher.connect();
    const stream = await this.fetcher.getStream();

    // consume the rest of the stream in order to cache the chunks
    await stream.pipeTo(new WritableStream());
    this.data = new Blob(this.fetcher.cachedChunks, {
      type: FILE_EXT_TO_MIME.dcm,
    });
  }

  stop() {
    this.fetcher.close();
  }
}
