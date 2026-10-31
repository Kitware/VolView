import { findElement, type DicomDataset } from './dicomDataset';
import { getDatasetTag } from './datasetAccess';
import { trimDicomPadding } from '../utils';

const NM_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.20';
const SLICE_VECTOR = '00540080';
const DETECTOR_INFORMATION = '00540022';

const text = (metadata: DicomDataset, tag: string) =>
  trimDicomPadding(getDatasetTag(metadata, tag) ?? '');

const number = (metadata: DicomDataset, tag: string) => {
  const value = text(metadata, tag);
  return value ? Number(value) : NaN;
};

const vector = (metadata: DicomDataset, tag: string) =>
  text(metadata, tag)
    .split('\\')
    .map((value) => Number(trimDicomPadding(value)));

const detectorItems = (metadata: DicomDataset) => {
  const values = findElement(metadata, DETECTOR_INFORMATION)?.values;
  return values?.kind === 'sequence' ? values.items : [];
};

const spatialPointer = (metadata: DicomDataset) => {
  const pointer = findElement(metadata, '00280009');
  if (!pointer) return true;
  return (
    pointer.values.kind === 'attributeTag' &&
    pointer.values.values.length === 1 &&
    pointer.values.values[0].group === 0x0054 &&
    pointer.values.values[0].element === 0x0080
  );
};

const singleDimension = (metadata: DicomDataset) =>
  [
    '00540011',
    '00540031',
    '00540051',
    '00540061',
    '00540071',
    '00540101',
  ].every((tag) => !text(metadata, tag) || number(metadata, tag) === 1);

const singleDimensionVectors = (metadata: DicomDataset) =>
  [
    '00540010',
    '00540020',
    '00540030',
    '00540050',
    '00540060',
    '00540070',
    '00540100',
  ].every(
    (tag) =>
      !text(metadata, tag) ||
      vector(metadata, tag).every((value) => value === 1)
  );

const orderedSlices = (metadata: DicomDataset, count: number) => {
  const values = text(metadata, SLICE_VECTOR);
  if (!values) return !findElement(metadata, '00280009');
  const slices = vector(metadata, SLICE_VECTOR);
  return (
    slices.length === count &&
    slices.every((slice, index) => slice === index + 1)
  );
};

type NmReconstruction =
  | { error: string }
  | { detector: DicomDataset; count: number; sliceSpacing: number | null };

const dimensionError = (
  metadata: DicomDataset,
  type: string,
  count: number
) => {
  if (!text(metadata, '00540081'))
    return 'Cannot allocate NM volume without NumberOfSlices';
  return type !== 'RECON TOMO' ||
    count !== number(metadata, '00540081') ||
    !singleDimension(metadata) ||
    !singleDimensionVectors(metadata) ||
    !spatialPointer(metadata)
    ? 'Unsupported NM volume with multiple spatial/time dimensions'
    : null;
};

const detectorError = (metadata: DicomDataset, detectors: DicomDataset[]) =>
  number(metadata, '00540021') !== 1 || detectors.length !== 1
    ? 'Unsupported NM volume with multiple or missing detectors'
    : null;

function sliceError(metadata: DicomDataset, count: number) {
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    !orderedSlices(metadata, count)
  )
    return 'Unsupported NM volume with unordered or missing slice indices';
  const spacing = number(metadata, '00180088');
  return (count === 1 && !text(metadata, '00180088')) ||
    (Number.isFinite(spacing) && spacing !== 0)
    ? null
    : 'Cannot allocate NM volume without nonzero slice spacing';
}

/**
 * NM detector coordinates describe a volume only for a single reconstructed
 * spatial stack. Projection and gated dimensions require their own assembly.
 */
export function readNmReconstruction(
  metadata: DicomDataset
): NmReconstruction | null {
  if (text(metadata, '00080016') !== NM_IMAGE_STORAGE) return null;
  const imageType = text(metadata, '00080008').split('\\')[2]?.trim() ?? '';
  if (imageType !== 'RECON TOMO' && imageType !== 'RECON GATED TOMO')
    return null;
  const count = number(metadata, '00280008');
  const detectors = detectorItems(metadata);
  const error =
    dimensionError(metadata, imageType, count) ??
    detectorError(metadata, detectors) ??
    sliceError(metadata, count);
  return error
    ? { error }
    : {
        detector: detectors[0],
        count,
        sliceSpacing: text(metadata, '00180088')
          ? number(metadata, '00180088')
          : null,
      };
}

export function getNmDetectorTag(metadata: DicomDataset, tag: string) {
  if (tag !== '00200032' && tag !== '00200037') return undefined;
  const reconstruction = readNmReconstruction(metadata);
  return reconstruction && !('error' in reconstruction)
    ? getDatasetTag(reconstruction.detector, tag)
    : undefined;
}
