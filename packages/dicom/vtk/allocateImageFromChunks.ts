import {
  Chunk,
  DicomDataset,
  getDatasetTag,
  getChunkTag,
  readGeometryFacts,
  sliceNormalOf,
  type Reconstruction,
  multiframeGeometry,
  declaredSpacing,
  physicalSpacing,
  readPixelSpacing,
  type SpatialMetadata,
} from '../core/index';
import { getFrameTag } from '../core/metadata/functionalGroups';
import { numberOr } from '../core/utils';
import { nmGeometry } from './nmGeometry';
import { readModalityRescale } from '../core/metadata/modalityRescale';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector3 } from '@kitware/vtk.js/types';
import { mat3 } from 'gl-matrix';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

const SpacingBetweenSlicesTag = '00180088';
const RowsTag = '00280010';
const ColumnsTag = '00280011';
const BitsStoredTag = '00280101';
const PixelRepresentationTag = '00280103';
const SamplesPerPixelTag = '00280002';
const NumberOfFrames = '00280008';

function isPositiveFiniteNumber(value: number) {
  return Number.isFinite(value) && value > 0;
}

function getBitStorageSize(num: number, signed: boolean) {
  const addSignedBit = signed ? 1 : 0;
  const val = num < 0 ? -num : num + 1; // range shift for log2
  const nbits = Math.ceil(Math.log2(val) + addSignedBit);
  // round up to a word size
  return 2 ** Math.ceil(Math.log2(nbits));
}

type TypedArrayConstructor =
  | typeof Int8Array
  | typeof Uint8Array
  | typeof Int16Array
  | typeof Uint16Array
  | typeof Int32Array
  | typeof Uint32Array;

const TYPED_ARRAY_VALUE_RANGES = new Map<
  TypedArrayConstructor,
  { min: number; max: number }
>([
  [Int8Array, { min: -(2 ** 7), max: 2 ** 7 - 1 }],
  [Uint8Array, { min: 0, max: 2 ** 8 - 1 }],
  [Int16Array, { min: -(2 ** 15), max: 2 ** 15 - 1 }],
  [Uint16Array, { min: 0, max: 2 ** 16 - 1 }],
  [Int32Array, { min: -(2 ** 31), max: 2 ** 31 - 1 }],
  [Uint32Array, { min: 0, max: 2 ** 32 - 1 }],
]);

/**
 * The values a buffer of the given element type can hold without wrapping.
 * Undefined for element types the allocator never produces, floats included.
 */
export function getTypedArrayValueRange(ctor: unknown) {
  return TYPED_ARRAY_VALUE_RANGES.get(ctor as TypedArrayConstructor);
}

/**
 * The values `buffer` can hold without wrapping, or undefined if its element
 * type has no fixed integer range to enforce.
 */
export function getBufferValueRange(buffer: ArrayBufferView) {
  return getTypedArrayValueRange(buffer.constructor);
}

/**
 * Whether a decoded value range is representable in `buffer`'s element type.
 * A buffer with no enforceable range accepts everything.
 */
export function valuesFitBuffer(
  range: { min: number; max: number },
  buffer: ArrayBufferView
) {
  const bufferRange = getBufferValueRange(buffer);
  if (!bufferRange) return true;
  return range.min >= bufferRange.min && range.max <= bufferRange.max;
}

/**
 * Whether every sample is a whole number, which an integer-element buffer
 * needs. Integer typed arrays hold nothing else, so only float or plain
 * arrays are scanned. A buffer with no integer range accepts everything.
 */
export function samplesAreIntegral(
  values: ArrayLike<number>,
  buffer: ArrayBufferView
) {
  if (!getBufferValueRange(buffer)) return true;
  if (
    ArrayBuffer.isView(values) &&
    !(values instanceof Float32Array) &&
    !(values instanceof Float64Array)
  ) {
    return true;
  }
  return Array.prototype.every.call(values, (value: number) =>
    Number.isInteger(value)
  );
}

export function getTypedArrayForDataRange(min: number, max: number) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max))
    throw new Error('Input must be integers');

  const isSigned = min < 0;
  const nbits = getBitStorageSize(
    Math.abs(min) > Math.abs(max) ? min : max,
    isSigned
  );

  if (nbits <= 8) return isSigned ? Int8Array : Uint8Array;
  if (nbits <= 16) return isSigned ? Int16Array : Uint16Array;
  if (nbits <= 32) return isSigned ? Int32Array : Uint32Array;

  throw new Error(`Cannot handle ${nbits}-bit sized ranges`);
}

/**
 * The tags that decide what values an instance decodes to.
 *
 * A bitsStored of 0 means the tag was absent or unparseable. It is not a DICOM
 * default: BitsStored is Type 1, so a conforming instance always carries one.
 */
export function getPixelFormat(
  metadata: DicomDataset | null | undefined,
  frameIndex = 0
) {
  const valueOf = (tag: string) => getFrameTag(metadata, tag, frameIndex);
  return {
    bitsStored: numberOr(valueOf(BitsStoredTag), 0),
    pixelRepresentation: numberOr(valueOf(PixelRepresentationTag), 0),
    ...readModalityRescale(metadata, frameIndex),
  };
}

type PixelFormat = ReturnType<typeof getPixelFormat>;

/**
 * The values an instance can decode to. ITK/GDCM applies RescaleSlope and
 * RescaleIntercept while decoding, so this is the range after rescaling.
 *
 * Null when BitsStored is missing, since nothing can be derived without it.
 */
export function getRescaledValueRange(format: PixelFormat) {
  const { bitsStored, pixelRepresentation, rescaleSlope, rescaleIntercept } =
    format;
  if (!Number.isInteger(bitsStored) || bitsStored <= 0) return null;

  const isSigned = pixelRepresentation === 1;
  const storedMin = isSigned ? -(2 ** (bitsStored - 1)) : 0;
  const storedMax = 2 ** (bitsStored - (isSigned ? 1 : 0)) - 1;
  const a = storedMin * rescaleSlope + rescaleIntercept;
  const b = storedMax * rescaleSlope + rescaleIntercept;

  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * The element type a volume allocated from instances of these formats holds.
 *
 * An instance whose tags give no finite range is left out of the union and
 * judged on its decoded values by the containment guard instead.
 */
export function getVolumeBufferType(formats: PixelFormat[]) {
  const usable = formats.flatMap((format) => {
    const range = getRescaledValueRange(format);
    return range && Number.isFinite(range.min) && Number.isFinite(range.max)
      ? [{ format, range }]
      : [];
  });
  if (usable.length === 0)
    throw new Error('No instance declares a finite modality rescale range');

  const needsFloat64 = usable.some(
    ({ format, range }) =>
      !Number.isInteger(format.rescaleSlope) ||
      !Number.isInteger(format.rescaleIntercept) ||
      !Number.isSafeInteger(range.min) ||
      !Number.isSafeInteger(range.max)
  );
  if (needsFloat64) return Float64Array;

  const min = Math.min(...usable.map(({ range }) => range.min));
  const max = Math.max(...usable.map(({ range }) => range.max));
  const exceedsSigned32 = min < 0 && (min < -(2 ** 31) || max > 2 ** 31 - 1);
  const exceedsUnsigned32 = min >= 0 && max > 2 ** 32 - 1;
  if (exceedsSigned32 || exceedsUnsigned32) return Float64Array;

  return getTypedArrayForDataRange(min, max);
}

function instancePixelFormats(chunk: Chunk) {
  const formats = Array.from(
    { length: numberOr(getDatasetTag(chunk.metadata, NumberOfFrames), 1) },
    (_, index) => getPixelFormat(chunk.metadata, index)
  );
  return formats;
}

export function allocateImageFromChunks(
  sortedChunks: Chunk[],
  orientation: number[] | null,
  reconstruction: Reconstruction,
  irregularGeometry: IrregularGeometryPolicy = 'preserve-order'
) {
  if (sortedChunks.length === 0) {
    throw new Error('Cannot allocate an image from zero chunks');
  }

  assertRegularGeometry(reconstruction, irregularGeometry);
  assertSliceSlots(reconstruction.slots, sortedChunks.length);
  const { rows, columns, slices, samplesPerPixel } = allocationShape(
    sortedChunks,
    reconstruction
  );
  const geometry = allocationGeometry(
    sortedChunks,
    orientation,
    reconstruction,
    irregularGeometry
  );
  const { position, direction } = geometry;
  const spatialMetadata = allocationSpatialMetadata(sortedChunks, geometry);
  const TypedArrayCtor = getVolumeBufferType(
    sortedChunks.flatMap(instancePixelFormats)
  );
  const pixelData = new TypedArrayCtor(
    rows * columns * slices * samplesPerPixel
  );

  const image = vtkImageData.newInstance();
  image.setExtent([0, columns - 1, 0, rows - 1, 0, slices - 1]);

  if (position) image.setOrigin(position as Vector3);

  image.setSpacing(spatialMetadata.axes.map((axis) => axis.value));

  if (direction) image.setDirection(direction as mat3);

  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: samplesPerPixel,
    values: pixelData,
  });
  image.getPointData().setScalars(dataArray);

  // Needed for volume rendering to work at start
  dataArray.setRange({ min: 0, max: 255 }, 0);

  return { image, spatialMetadata };
}

/** Preserve acquisition order and its fallback spacing, or require a regular lattice. */
export type IrregularGeometryPolicy = 'preserve-order' | 'reject';

function assertRegularGeometry(
  reconstruction: Reconstruction,
  policy: IrregularGeometryPolicy
) {
  if (reconstruction.kind === 'irregular' && policy === 'reject')
    throw new Error(
      `Cannot allocate irregular DICOM geometry: ${reconstruction.reason}`
    );
}

const instanceGeometry = (metadata: DicomDataset, count: number) =>
  nmGeometry(metadata) ?? multiframeGeometry(metadata, count);

function allocationDirection(
  orientation: number[] | null,
  frameDirection?: number[] | null
) {
  const normal = frameDirection ?? sliceNormalOf(orientation);
  return orientation && normal ? [...orientation, ...normal] : null;
}

function allocationGeometry(
  chunks: Chunk[],
  orientation: number[] | null,
  reconstruction: Reconstruction,
  policy: IrregularGeometryPolicy
) {
  const metadata = chunks[0].metadata!;
  const count = numberOr(getDatasetTag(metadata, NumberOfFrames), 1);
  const frames = chunks.length === 1 ? instanceGeometry(metadata, count) : null;
  const geometry = frames ?? readGeometryFacts(metadata);
  const plan = frames?.reconstruction ?? reconstruction;
  assertRegularGeometry(plan, policy);
  const effectiveOrientation = orientation ?? geometry.orientation;
  return {
    ...geometry,
    reconstruction: plan,
    sliceSpacingSource: frames?.sliceSpacingSource ?? 'ImagePositionPatient',
    direction: allocationDirection(effectiveOrientation, frames?.direction),
  };
}

function assertSliceSlots(slots: number[], count: number) {
  if (
    slots.length !== count ||
    new Set(slots).size !== count ||
    slots.some((slot) => !Number.isSafeInteger(slot) || slot < 0) ||
    (count > 0 && slots[0] !== 0)
  )
    throw new Error(
      'Reconstruction must map each chunk to one distinct nonnegative slice slot, starting at zero'
    );
}

function allocationShape(chunks: Chunk[], reconstruction: Reconstruction) {
  const valueOf = (tag: string) => getChunkTag(chunks[0], tag);
  const numberOfFrames = numberOr(valueOf(NumberOfFrames), 1);
  if (numberOfFrames > 1 && chunks.length > 1)
    throw new Error(
      'First chunk in a group of chunks (size > 1) is a multi-frame chunk'
    );
  return {
    rows: numberOr(valueOf(RowsTag), 0),
    columns: numberOr(valueOf(ColumnsTag), 0),
    samplesPerPixel: numberOr(valueOf(SamplesPerPixelTag), 1),
    slices:
      chunks.length > 1
        ? Math.max(...reconstruction.slots) + 1
        : numberOfFrames,
  };
}

function allocationNotes(
  chunks: Chunk[],
  geometry: ReturnType<typeof allocationGeometry>
) {
  const notes = [];
  if (!geometry.position)
    notes.push(
      'Patient position is unavailable; the display uses a zero origin.'
    );
  if (!geometry.direction)
    notes.push(
      'Patient orientation is unavailable; the display uses default axes.'
    );
  if (
    chunks.length > 1 &&
    chunks.some((chunk) =>
      readPixelSpacing(chunk.metadata).some(
        (axis) => axis.status === 'fallback'
      )
    )
  )
    notes.push(
      'Some slices lack usable PixelSpacing; the displayed in-plane grid uses the first slice.'
    );
  return notes;
}

function allocationCalibration(metadata: DicomDataset | null | undefined) {
  const type = getDatasetTag(metadata, '00280A02')?.trim();
  const description = getDatasetTag(metadata, '00280A04')?.trim();
  return type || description ? { calibration: { type, description } } : {};
}

function allocationSpatialMetadata(
  chunks: Chunk[],
  geometry: ReturnType<typeof allocationGeometry>
): SpatialMetadata {
  const metadata = chunks[0].metadata;
  const { reconstruction, sliceSpacingSource } = geometry;
  const sliceSpacing = reconstruction.sliceSpacing ?? 0;
  const z = isPositiveFiniteNumber(sliceSpacing)
    ? physicalSpacing(
        sliceSpacing,
        sliceSpacingSource,
        sliceSpacingSource === 'ImagePositionPatient' ? 'derived' : 'declared'
      )
    : declaredSpacing(
        getFrameTag(metadata, SpacingBetweenSlicesTag),
        'SpacingBetweenSlices'
      );
  return {
    axes: [...readPixelSpacing(metadata), z],
    reconstruction: {
      kind: reconstruction.kind,
      ...(reconstruction.kind === 'irregular'
        ? { reason: reconstruction.reason }
        : {}),
    },
    notes: allocationNotes(chunks, geometry),
    ...allocationCalibration(metadata),
  };
}
