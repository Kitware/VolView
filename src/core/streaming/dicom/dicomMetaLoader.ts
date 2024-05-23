import { createDicomParser } from '@/src/core/streaming/dicom/dicomParser';
import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import { Fetcher, MetaLoader } from '@/src/core/streaming/types';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { Maybe } from '@/src/types';
import { Awaitable } from '@vueuse/core';

export type ReadDicomTagsFunction = (
  file: File
) => Awaitable<Array<[string, string]>>;

export class DicomMetaLoader implements MetaLoader {
  private tags: Maybe<Array<[string, string]>>;
  private fetcher: Fetcher;
  private readDicomTags: ReadDicomTagsFunction;

  constructor(fetcher: Fetcher, readDicomTags: ReadDicomTagsFunction) {
    this.fetcher = fetcher;
    this.readDicomTags = readDicomTags;
  }

  get meta() {
    return this.tags;
  }

  get metaBlob() {
    return new Blob(this.fetcher.cachedChunks, { type: FILE_EXT_TO_MIME.dcm });
  }

  async load() {
    if (this.tags) return;

    await this.fetcher.connect();
    const stream = this.fetcher.getStream();

    const parse = createDicomParser(12);

    const sinkStream = new WritableStream({
      write: (chunk) => {
        const result = parse(chunk);
        if (result.done) {
          this.fetcher.close();
        }
      },
    });

    try {
      await stream.pipeTo(sinkStream, {
        // ensure we use the fetcher's abort signal,
        // otherwise a DOMException will be propagated
        signal: this.fetcher.abortSignal,
      });
    } catch (err) {
      if (err !== StopSignal) {
        throw err;
      }
    }

    const metadataFile = new File(this.fetcher.cachedChunks, 'file.dcm');
    this.tags = await this.readDicomTags(metadataFile);
  }

  stop() {
    this.fetcher.close();
  }
}
