import {
  EXPLICIT_VR_LITTLE_ENDIAN,
  getDatasetTag,
  IMPLICIT_VR_LITTLE_ENDIAN,
  indexFrames,
  isUltrasoundMultiframeSopClass,
  readBytes,
  splitEncapsulatedFrames,
  Tags,
  trimDicomPadding,
  ultrasoundRegionsOf,
  type DicomDataset,
  type Instance,
} from '@/packages/dicom/core';

const JPEG_BASELINE = '1.2.840.10008.1.2.4.50';

const NATIVE_TRANSFER_SYNTAXES = new Set([
  IMPLICIT_VR_LITTLE_ENDIAN,
  EXPLICIT_VR_LITTLE_ENDIAN,
]);

const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  ...NATIVE_TRANSFER_SYNTAXES,
  JPEG_BASELINE,
]);

export const isNativeTransferSyntax = (uid: string) =>
  NATIVE_TRANSFER_SYNTAXES.has(uid);

export const isSupportedCineTransferSyntax = (uid: string) =>
  SUPPORTED_TRANSFER_SYNTAXES.has(uid);

export type CineHeader = {
  transferSyntaxUID: string;
  rows: number;
  cols: number;
  numberOfFrames: number;
  samplesPerPixel: number;
  bitsAllocated: number;
  planarConfiguration: number;
  photometricInterpretation: string;
  pixelSpacing: [number, number] | null;
  frameTimeMs: number | null;
  patient: {
    PatientID: string;
    PatientName: string;
    PatientBirthDate: string;
    PatientSex: string;
  };
  study: {
    StudyID: string;
    StudyInstanceUID: string;
    StudyDate: string;
    StudyTime: string;
    AccessionNumber: string;
    StudyDescription: string;
  };
  series: {
    SeriesInstanceUID: string;
    SeriesNumber: string;
    SeriesDescription: string;
    Modality: string;
  };
  regions: ReturnType<typeof ultrasoundRegionsOf>;
};

const text = (dataset: DicomDataset, tag: string) =>
  trimDicomPadding(getDatasetTag(dataset, tag) ?? '');

/** NaN unless the value is a finite number. */
const numberOf = (value: string | undefined) => {
  const trimmed = trimDicomPadding(value ?? '');
  const number = Number(trimmed);
  return trimmed && Number.isFinite(number) ? number : NaN;
};

const finiteOrNull = (dataset: DicomDataset, tag: string) => {
  const value = numberOf(getDatasetTag(dataset, tag));
  return Number.isFinite(value) ? value : null;
};

// Absent or zero counts read as their defaults.
const countOr = (dataset: DicomDataset, tag: string, fallback: number) =>
  numberOf(getDatasetTag(dataset, tag)) || fallback;

function positivePair(dataset: DicomDataset, tag: string) {
  const values = (getDatasetTag(dataset, tag) ?? '').split('\\').map(numberOf);
  const [first, second] = values;
  return values.length >= 2 && first > 0 && second > 0
    ? ([first, second] as [number, number])
    : null;
}

const transferSyntaxOf = (instance: Instance) =>
  trimDicomPadding(instance.transferSyntaxUid ?? '');

/** What a cine clip shows and plays, from the header alone. */
export function readCineHeader(instance: Instance): CineHeader {
  const { dataset } = instance;
  const tag = (name: string) => text(dataset, name);
  return {
    transferSyntaxUID: transferSyntaxOf(instance),
    rows: countOr(dataset, Tags.Rows, 0),
    cols: countOr(dataset, Tags.Columns, 0),
    numberOfFrames: countOr(dataset, Tags.NumberOfFrames, 1),
    samplesPerPixel: countOr(dataset, Tags.SamplesPerPixel, 1),
    bitsAllocated: countOr(dataset, Tags.BitsAllocated, 8),
    planarConfiguration: countOr(dataset, Tags.PlanarConfiguration, 0),
    photometricInterpretation: tag(Tags.PhotometricInterpretation),
    pixelSpacing: positivePair(dataset, Tags.PixelSpacing),
    frameTimeMs: finiteOrNull(dataset, Tags.FrameTime),
    patient: {
      PatientID: tag(Tags.PatientID),
      PatientName: tag(Tags.PatientName),
      PatientBirthDate: tag(Tags.PatientBirthDate),
      PatientSex: tag(Tags.PatientSex),
    },
    study: {
      StudyID: tag(Tags.StudyID),
      StudyInstanceUID: tag(Tags.StudyInstanceUID),
      StudyDate: tag(Tags.StudyDate),
      StudyTime: tag(Tags.StudyTime),
      AccessionNumber: tag(Tags.AccessionNumber),
      StudyDescription: tag(Tags.StudyDescription),
    },
    series: {
      SeriesInstanceUID: tag(Tags.SeriesInstanceUID),
      SeriesNumber: tag(Tags.SeriesNumber),
      SeriesDescription: tag(Tags.SeriesDescription),
      Modality: tag(Tags.Modality),
    },
    regions: ultrasoundRegionsOf(dataset),
  };
}

// Native clips play as 8 bit grayscale or RGB only.
function supportedNativePixels(dataset: DicomDataset) {
  if (countOr(dataset, Tags.BitsAllocated, 8) !== 8) return false;
  const photometric = text(dataset, Tags.PhotometricInterpretation);
  const samples = countOr(dataset, Tags.SamplesPerPixel, 1);
  if (samples === 1) return photometric === 'MONOCHROME2';
  return samples === 3 && photometric === 'RGB';
}

/**
 * Whether an instance plays as a cine clip: a Part 10 ultrasound multi-frame
 * image of more than one frame, in a syntax and pixel format the player reads.
 */
export function isCineInstance(instance: Instance) {
  const { dataset } = instance;
  const transferSyntax = transferSyntaxOf(instance);
  return (
    instance.layout?.preamble === true &&
    instance.pixelData !== null &&
    isUltrasoundMultiframeSopClass(text(dataset, Tags.SOPClassUID)) &&
    numberOf(getDatasetTag(dataset, Tags.NumberOfFrames)) > 1 &&
    isSupportedCineTransferSyntax(transferSyntax) &&
    (!isNativeTransferSyntax(transferSyntax) || supportedNativePixels(dataset))
  );
}

async function readNativeFrames(instance: Instance, signal: AbortSignal) {
  const index = indexFrames(instance);
  if (index.kind !== 'indexed')
    throw new Error(`Cannot locate the cine frames: ${index.detail}`);
  const { frames, frameLength } = index;
  const first = frames[0].start;
  const bytes = await readBytes(instance.source, signal, {
    start: first,
    end: first + frames.length * frameLength,
  });
  if (bytes.length < frames.length * frameLength)
    throw new Error('The cine Pixel Data is cut short');
  return frames.map(({ start }) =>
    bytes.subarray(start - first, start - first + frameLength)
  );
}

/** Each frame's stored bytes: raw samples when native, a codestream when encapsulated. */
export async function readCineFrames(
  instance: Instance,
  header: CineHeader,
  signal: AbortSignal
) {
  if (isNativeTransferSyntax(header.transferSyntaxUID))
    return readNativeFrames(instance, signal);
  if (!instance.pixelData || instance.pixelData.length !== null)
    throw new Error('The cine Pixel Data is not encapsulated');
  const value = await readBytes(instance.source, signal, {
    start: instance.pixelData.valueOffset,
  });
  return splitEncapsulatedFrames(value, header.numberOfFrames);
}
