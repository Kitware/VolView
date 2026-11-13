import type { ByteSource } from '../source/byteSource';
import {
  readDicomDataset,
  withoutPrivateElements,
  type DicomDataset,
} from '../metadata/dicomDataset';
import type { DicomLayout } from '../metadata/dicomLayout';
import { getDatasetModality } from '../metadata/datasetAccess';
import {
  readDicomHeader,
  type ImageImportPolicy,
  type PixelDataElement,
} from '../header/readDicomHeader';
import {
  readUltrasoundRegions,
  type UltrasoundRegions,
} from '../metadata/ultrasoundRegion';
import type { Awaitable } from '../utils';

/**
 * One parsed header and where its bytes live. The dataset omits private
 * elements, including those nested in public sequences; the source still
 * holds every original byte. Identity matters: registries and volumes
 * recognize an instance by this object.
 */
export type Instance = Readonly<{
  source: ByteSource;
  dataset: DicomDataset;
  /** How the bytes opened: with or without the Part 10 preamble and file meta. */
  layout: DicomLayout | null;
  ultrasoundRegions: UltrasoundRegions | null;
  /** As the file meta names it, or as a bare data set's first element suggests. */
  transferSyntaxUid: string | null;
  /** Null when the header names no Pixel Data or its element head is cut short. */
  pixelData: PixelDataElement | null;
}>;

export type ReadInstanceOptions = {
  readDataset?: (bytes: Uint8Array) => Awaitable<DicomDataset>;
  imageImportPolicy?: ImageImportPolicy;
};

/** Reads the header only, cancelling the stream where Pixel Data begins. */
export async function readInstance(
  source: ByteSource,
  signal: AbortSignal,
  options: ReadInstanceOptions = {}
): Promise<Instance> {
  signal.throwIfAborted();
  const { header, layout, transferSyntaxUid, pixelData } =
    await readDicomHeader(source.read(signal), options.imageImportPolicy);
  signal.throwIfAborted();
  const parsed = await (options.readDataset ?? readDicomDataset)(header);
  signal.throwIfAborted();
  const dataset = withoutPrivateElements(parsed);
  return Object.freeze({
    source,
    dataset,
    layout,
    ultrasoundRegions:
      getDatasetModality(dataset) === 'US'
        ? readUltrasoundRegions(dataset)
        : null,
    transferSyntaxUid,
    pixelData,
  });
}
