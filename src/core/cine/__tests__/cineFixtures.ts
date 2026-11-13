import { datasetFromTags } from '@/tests/dicomDataset';
import {
  fromBlob,
  SOP_CLASS_ULTRASOUND_MULTIFRAME,
  Tags,
  type DicomDataset,
  type Instance,
} from '@/packages/dicom/core';
import { useImageCacheStore } from '@/src/store/image-cache';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import DicomCineImage from '@/src/core/cine/DicomCineImage';

export const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
export const TS_JPEG_BASELINE = '1.2.840.10008.1.2.4.50';

/** A two-frame 2x2 native grayscale clip, keyed 'gggg|eeee'. */
const CINE_TAGS: Record<string, string> = {
  [Tags.SOPClassUID]: SOP_CLASS_ULTRASOUND_MULTIFRAME,
  [Tags.SOPInstanceUID]: 'cine-sop',
  [Tags.NumberOfFrames]: '2',
  [Tags.Rows]: '2',
  [Tags.Columns]: '2',
  [Tags.SamplesPerPixel]: '1',
  [Tags.BitsAllocated]: '8',
  [Tags.BitsStored]: '8',
  [Tags.PixelRepresentation]: '0',
  [Tags.PhotometricInterpretation]: 'MONOCHROME2',
  [Tags.Modality]: 'US',
  [Tags.PatientID]: 'patient-1',
  [Tags.PatientName]: 'Test Patient',
  [Tags.StudyID]: 'study-1',
  [Tags.StudyInstanceUID]: 'study-uid',
  [Tags.SeriesInstanceUID]: 'series-uid',
  [Tags.SeriesNumber]: '1',
  [Tags.SeriesDescription]: 'Cine',
};

type CineInstanceOptions = {
  transferSyntaxUid?: string;
  /** The Pixel Data value; the source holds nothing else. */
  pixels?: Uint8Array;
  /** Elements added after the tags, such as sequences. */
  elements?: DicomDataset['elements'];
};

/**
 * A clip header as `readInstance` returns it from a Part 10 file whose Pixel
 * Data value is the whole source.
 */
export const cineInstance = (
  tags: Record<string, string> = {},
  {
    transferSyntaxUid = TS_EXPLICIT_VR_LE,
    pixels = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80]),
    elements = [],
  }: CineInstanceOptions = {}
): Instance => {
  const dataset = datasetFromTags(Object.entries({ ...CINE_TAGS, ...tags }));
  return Object.freeze({
    source: fromBlob(new Blob([pixels as BlobPart])),
    dataset: { ...dataset, elements: [...dataset.elements, ...elements] },
    layout: { preamble: true, fileMeta: true } as const,
    ultrasoundRegions: null,
    transferSyntaxUid,
    pixelData: {
      offset: 0,
      valueOffset: 0,
      length: transferSyntaxUid === TS_JPEG_BASELINE ? null : pixels.length,
    },
  });
};

/**
 * Seats a volume the real `isCineImage` reports as cine. Requires an active
 * pinia.
 */
export const markCine = (imageID: string) =>
  seatVolume(imageID, { kind: 'cine' });

/**
 * Seats a real two-frame clip under `imageID`, both in the DICOM store (so
 * `isCineImage` says yes) and in the image cache (so `getCineImage` hands the
 * clip back). Requires an active pinia.
 */
export const seatCineImage = (
  imageID: string,
  tags: Record<string, string> = {}
) => {
  markCine(imageID);
  const image = new DicomCineImage(cineInstance(tags));
  useImageCacheStore().addProgressiveImage(image, { id: imageID });
  return image;
};
