import { createDicomParser } from '@/src/core/streaming/dicom/dicomParser';
import { StopSignal } from '@/src/core/streaming/cachedStreamFetcher';
import { Fetcher, MetaLoader } from '@/src/core/streaming/types';
import { Maybe } from '@/src/types';
import { Awaitable } from '@vueuse/core';
import { Tags } from '@/src/core/dicomTags';
import { readDicomTagsOffThread } from '@/src/io/readDicomTagsOffThread';
import type { DicomLayout } from '@/src/io/dicomLayout';
import { concatBytes, toAscii } from '@/src/utils';
import {
  decodeUltrasoundRegion,
  SEQUENCE_OF_ULTRASOUND_REGIONS,
  UltrasoundRegions,
} from '@/src/core/streaming/dicom/ultrasoundRegion';

export type ReadDicomTagsFunction = (
  bytes: Uint8Array
) => Awaitable<Array<[string, string]>>;

const MODALITY = [0x0008, 0x0060] as const;
const PIXEL_DATA = [0x7fe0, 0x0010] as const;

const isTag = (
  tag: readonly [number, number],
  group: number,
  element: number
) => group === tag[0] && element === tag[1];

/**
 * Radiotherapy objects are dropped on their modality alone, so nothing past
 * that element is read: a structure set carries megabytes of contours.
 */
const isRadiotherapy = (modality: string | undefined) =>
  modality?.startsWith('RT') ?? false;

export class DicomMetaLoader implements MetaLoader {
  private tags: Maybe<Array<[string, string]>>;
  private offset: Maybe<number>;
  private layout: Maybe<DicomLayout>;
  public ultrasoundRegions: UltrasoundRegions | undefined;

  constructor(
    private fetcher: Fetcher,
    private readTags: ReadDicomTagsFunction = readDicomTagsOffThread
  ) {}

  get meta() {
    return this.tags;
  }

  /**
   * Where Pixel Data starts, or the file's length when it has none. Unset for
   * a radiotherapy object, whose header past Modality is never read.
   */
  get pixelDataOffset() {
    return this.offset;
  }

  /** How the bytes opened: with or without the Part 10 preamble and file meta. */
  get fileLayout() {
    return this.layout;
  }

  private async readHeader(
    stream: ReadableStream<Uint8Array>,
    parse: ReturnType<typeof createDicomParser>
  ) {
    let pixelDataIdx = -1;
    // The bytes read so far live here rather than in the fetcher: the header
    // is parsed once and then done with, and a fetcher over a file has no
    // reason to keep a copy of it for the chunk's lifetime.
    const received: Uint8Array[] = [];

    // Read a chunk at a time and cancel the moment the header ends: a stream
    // that reads ahead pulls pixel data this loader never uses.
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(value);
        const result = parse(value);
        if (result.done) {
          pixelDataIdx = result.value.position;
          break;
        }
      }
    } catch (err) {
      if (err !== StopSignal) throw err;
      // Stopped from outside before the header ended, so what arrived is not
      // a header and must not be read as one.
      throw new Error('The DICOM header read was stopped before it finished');
    } finally {
      // Not awaited, so the cancel lands before the stream refills its queue.
      reader.cancel().catch(() => {});
      this.fetcher.close();
    }
    return { received, pixelDataIdx };
  }

  async load() {
    if (this.tags) return;

    await this.fetcher.connect();
    const stream = this.fetcher.getStream();
    let modality: string | undefined;
    let ultrasoundRegions: UltrasoundRegions | undefined;

    const parse = createDicomParser({
      stopAtElement: (group, element) =>
        isTag(PIXEL_DATA, group, element) || isRadiotherapy(modality),
      onLayout: (layout) => {
        this.layout = layout;
      },
      onDataElement: (el) => {
        if (
          isTag(MODALITY, el.group, el.element) &&
          el.data instanceof Uint8Array
        )
          modality = toAscii(el.data).trim();
        if (
          isTag(SEQUENCE_OF_ULTRASOUND_REGIONS, el.group, el.element) &&
          !ultrasoundRegions
        ) {
          // Decoding can throw if a malformed FD/US value has an unexpected
          // length; swallow rather than abort the whole metadata load.
          try {
            ultrasoundRegions = decodeUltrasoundRegion(el.data);
          } catch (err) {
            console.warn('Failed to decode SequenceOfUltrasoundRegions:', err);
          }
        }
      },
    });

    const { received, pixelDataIdx } = await this.readHeader(stream, parse);

    if (isRadiotherapy(modality)) {
      this.tags = [[Tags.Modality, modality as string]];
      return;
    }

    // An object with no Pixel Data, such as a structured report, is header to
    // its last byte.
    const header = concatBytes(
      received,
      pixelDataIdx < 0 ? undefined : pixelDataIdx
    );
    this.offset = header.length;
    this.tags = await this.readTags(header);

    if (modality === 'US' && ultrasoundRegions) {
      this.ultrasoundRegions = ultrasoundRegions;
    }
  }

  stop() {
    this.fetcher.close();
  }
}
