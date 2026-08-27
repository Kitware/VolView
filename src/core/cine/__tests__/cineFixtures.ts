import { useImageCacheStore } from '@/src/store/image-cache';
import { seatVolume } from '@/src/store/__tests__/datasetFixtures';
import DicomCineImage from '@/src/core/cine/DicomCineImage';
import type {
  CineHeader,
  CineParseResult,
} from '@/src/core/cine/parseCineDicom';

const TS_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

/**
 * Seats a volume the real `isCineImage` reports as cine. Requires an active
 * pinia.
 */
export const markCine = (imageID: string) =>
  seatVolume(imageID, { kind: 'cine' });

export const cineHeader = (
  overrides: Partial<CineHeader> = {}
): CineHeader => ({
  transferSyntaxUID: TS_EXPLICIT_VR_LE,
  rows: 2,
  cols: 2,
  numberOfFrames: 2,
  samplesPerPixel: 1,
  bitsAllocated: 8,
  planarConfiguration: 0,
  photometricInterpretation: 'MONOCHROME2',
  pixelSpacing: null,
  frameTimeMs: null,
  patient: {
    PatientID: 'patient-1',
    PatientName: 'Test Patient',
    PatientBirthDate: '',
    PatientSex: '',
  },
  study: {
    StudyID: 'study-1',
    StudyInstanceUID: 'study-uid',
    StudyDate: '',
    StudyTime: '',
    AccessionNumber: '',
    StudyDescription: '',
  },
  series: {
    SeriesInstanceUID: 'series-uid',
    SeriesNumber: '1',
    SeriesDescription: 'Cine',
    Modality: 'US',
  },
  regions: [],
  ...overrides,
});

export const cineParseResult = (header: CineHeader): CineParseResult => ({
  header,
  frames: [new Uint8Array(4), new Uint8Array(4)],
  encapsulated: false,
});

/**
 * Seats a real two-frame clip under `imageID`, both in the DICOM store (so
 * `isCineImage` says yes) and in the image cache (so `getCineImage` hands the
 * clip back). Requires an active pinia.
 */
export const seatCineImage = (
  imageID: string,
  header: Partial<CineHeader> = {}
) => {
  markCine(imageID);
  const image = new DicomCineImage(cineParseResult(cineHeader(header)));
  useImageCacheStore().addProgressiveImage(image, { id: imageID });
  return image;
};
