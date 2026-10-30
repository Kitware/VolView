import { createDicomParser } from './dicomParser';
import { StopSignal } from '../cachedStreamFetcher';
import { Fetcher, MetaLoader } from '../types';
import { Maybe } from '../../utils';
import { Awaitable } from '../../utils';

import {
  readDicomDataset,
  type DicomDataset,
} from '../../metadata/dicomDataset';
import type { DicomLayout } from '../../metadata/dicomLayout';
import { concatBytes, toAscii } from '../../utils';
import {
  decodeUltrasoundRegion,
  SEQUENCE_OF_ULTRASOUND_REGIONS,
  UltrasoundRegions,
} from './ultrasoundRegion';

export type ReadDicomDatasetFunction = (
  bytes: Uint8Array
) => Awaitable<DicomDataset>;

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
  private tags: Maybe<DicomDataset>;
  private generation = 0;
  private source: Fetcher | null;
  private offset: Maybe<number>;
  private layout: Maybe<DicomLayout>;
  public ultrasoundRegions: UltrasoundRegions | undefined;

  constructor(
    fetcher: Fetcher,
    private readDataset: ReadDicomDatasetFunction = readDicomDataset,
    private imageImportPolicy:
      | 'complete-header'
      | 'skip-radiotherapy' = 'complete-header'
  ) {
    this.source = fetcher;
  }

  private get fetcher() {
    if (!this.source)
      throw new DOMException('DICOM metadata loader disposed', 'AbortError');
    return this.source;
  }

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
    const generation = this.generation;
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
      if (generation === this.generation) this.fetcher.close();
    }
    return { received, pixelDataIdx };
  }

  async load() {
    if (this.tags) return;

    const generation = this.generation;
    await this.fetcher.connect();
    if (generation !== this.generation)
      throw new DOMException('DICOM read cancelled', 'AbortError');
    const stream = this.fetcher.getStream();
    let modality: string | undefined;
    let ultrasoundRegions: UltrasoundRegions | undefined;

    const parse = createDicomParser({
      stopAtElement: (group, element) =>
        isTag(PIXEL_DATA, group, element) ||
        (this.imageImportPolicy === 'skip-radiotherapy' &&
          isRadiotherapy(modality)),
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

    // An object with no Pixel Data, such as a structured report, is header to
    // its last byte.
    const header = concatBytes(
      received,
      pixelDataIdx < 0 ? undefined : pixelDataIdx
    );
    const dataset = await this.readDataset(header);
    if (generation !== this.generation)
      throw new DOMException('DICOM read cancelled', 'AbortError');
    this.offset =
      this.imageImportPolicy === 'skip-radiotherapy' && isRadiotherapy(modality)
        ? undefined
        : header.length;
    this.tags = dataset;

    if (modality === 'US' && ultrasoundRegions) {
      this.ultrasoundRegions = ultrasoundRegions;
    }
  }

  dispose() {
    this.stop();
    this.source = null;
  }

  stop() {
    this.generation += 1;
    this.source?.close();
  }
}
