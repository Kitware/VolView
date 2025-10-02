import {
  createDicomParser,
  ImplicitTransferSyntaxUID,
} from '@/src/core/streaming/dicom/dicomParser';
import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import { Fetcher, MetaLoader } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';
import { Awaitable } from '@vueuse/core';
import { toAscii } from '@/src/utils';
import { FILE_EXT_TO_MIME } from '@/src/io/mimeTypes';
import { Tags } from '@/src/core/dicomTags';

export type ReadDicomTagsFunction = (
  file: File
) => Awaitable<Array<[string, string]>>;

function generateEmptyPixelData(explicitVr: boolean) {
  // prettier-ignore
  return new Uint8Array([
    0xe0, 0x7f, 0x10, 0x00, // PixelData (group, element)
    ...(explicitVr ? [0x4f, 0x42, 0x00, 0x00] : []), // OB
    0, 0, 0, 0 // zero length
  ]);
}

export class DicomMetaLoader implements MetaLoader {
  private tags: Maybe<Array<[string, string]>>;
  private fetcher: Fetcher;
  private readDicomTags: ReadDicomTagsFunction;
  private blob: Blob | null;

  constructor(fetcher: Fetcher, readDicomTags: ReadDicomTagsFunction) {
    this.fetcher = fetcher;
    this.readDicomTags = readDicomTags;
    this.blob = null;
  }

  get meta() {
    return this.tags;
  }

  get metaBlob() {
    return this.blob;
  }

  async load() {
    if (this.tags) return;

    await this.fetcher.connect();
    const stream = this.fetcher.getStream();
    let explicitVr = true;
    let dicomUpToPixelDataIdx = -1;
    let modality: string | undefined;

    const parse = createDicomParser({
      stopAtElement(group, element) {
        // PixelData
        return group === 0x7fe0 && element === 0x0010;
      },
      onDataElement: (el) => {
        if (el.group === 0x0002 && el.element === 0x0010) {
          const transferSyntaxUid = toAscii(el.data as Uint8Array);
          explicitVr = transferSyntaxUid !== ImplicitTransferSyntaxUID;
        }
        // Capture Modality tag (0008,0060)
        if (el.group === 0x0008 && el.element === 0x0060 && el.data) {
          modality = toAscii(el.data as Uint8Array).trim();
        }
      },
    });

    const sinkStream = new WritableStream({
      write: (chunk) => {
        const result = parse(chunk);
        if (result.done) {
          dicomUpToPixelDataIdx = result.value.position;
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

    // itk.wasm/GDCM requires valid pixel data to be present, so we need to
    // generate fake pixel data. Valid means valid length and VR.
    // It turns out that encapsulated pixel data structures are parsed, even if
    // the pixel data itself is not touched. This does not work well with
    // metadata streaming.
    const metaBlob = new Blob(this.fetcher.cachedChunks).slice(
      0,
      dicomUpToPixelDataIdx
    );
    const validPixelDataBlob = new Blob(
      [metaBlob, generateEmptyPixelData(explicitVr)],
      { type: FILE_EXT_TO_MIME.dcm }
    );

    this.blob = validPixelDataBlob;

    // Skip ITK-WASM for RT modalities as they're not supported
    if (modality?.startsWith('RT')) {
      this.tags = [[Tags.Modality, modality]];
      return;
    }

    const metadataFile = new File([validPixelDataBlob], 'file.dcm');
    this.tags = await this.readDicomTags(metadataFile);
  }

  stop() {
    this.fetcher.close();
  }
}
