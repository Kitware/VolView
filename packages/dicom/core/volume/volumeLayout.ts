import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag, getDatasetModality } from '../metadata/datasetAccess';
import { readGeometryFacts, sliceNormalOf } from '../collections/instanceFacts';
import {
  reconstructInstances,
  type Reconstruction,
} from '../collections/reconstructVolume';
import { multiframeGeometry } from '../collections/multiframeGeometry';
import { readDatasetDetails } from '../collections/datasetDetails';
import {
  declaredSpacing,
  physicalSpacing,
  readPixelSpacing,
  type SpatialMetadata,
} from '../metadata/spatialMetadata';
import { getFrameTag } from '../metadata/functionalGroups';
import type { UltrasoundRegions } from '../streaming/dicom/ultrasoundRegion';
import { numberOr } from '../utils';
import { nmGeometry } from './nmGeometry';
import { getVolumeBufferType, instancePixelFormats } from './pixelFormat';
import { applyUltrasoundSpacing } from './ultrasoundSpacing';

const SpacingBetweenSlicesTag = '00180088';
const RowsTag = '00280010';
const ColumnsTag = '00280011';
const SamplesPerPixelTag = '00280002';
const NumberOfFrames = '00280008';

/** What allocation reads from one member: its header and ultrasound regions. */
export type VolumeSource = {
  dataset: DicomDataset;
  ultrasoundRegions?: UltrasoundRegions | null;
};

/** Preserve acquisition order and its fallback spacing, or require a regular lattice. */
export type IrregularGeometryPolicy = 'preserve-order' | 'reject';

const isPositiveFiniteNumber = (value: number) =>
  Number.isFinite(value) && value > 0;

const frameCountOf = (dataset: DicomDataset) =>
  numberOr(getDatasetTag(dataset, NumberOfFrames), 1);

function assertRegularGeometry(
  reconstruction: Reconstruction,
  policy: IrregularGeometryPolicy
) {
  if (reconstruction.kind === 'irregular' && policy === 'reject')
    throw new Error(
      `Cannot allocate irregular DICOM geometry: ${reconstruction.reason}`
    );
}

const instanceGeometry = (dataset: DicomDataset, count: number) => {
  const nm = nmGeometry(dataset);
  if (nm) return nm;
  if (count < 2) return null;
  // SEG planning does not judge segment-major frames as one spatial stack.
  if (getDatasetModality(dataset) === 'SEG')
    return multiframeGeometry(dataset, count);
  return readDatasetDetails(dataset).frameGeometry;
};

function allocationDirection(
  orientation: number[] | null,
  frameDirection?: number[] | null
) {
  const normal = frameDirection ?? sliceNormalOf(orientation);
  return orientation && normal ? [...orientation, ...normal] : null;
}

function allocationGeometry(
  sources: readonly VolumeSource[],
  orientation: number[] | null,
  reconstruction: Reconstruction,
  policy: IrregularGeometryPolicy
) {
  const { dataset } = sources[0];
  const frames =
    sources.length === 1
      ? instanceGeometry(dataset, frameCountOf(dataset))
      : null;
  const geometry = frames ?? readGeometryFacts(dataset);
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

function allocationShape(
  sources: readonly VolumeSource[],
  reconstruction: Reconstruction
) {
  const valueOf = (tag: string) => getDatasetTag(sources[0].dataset, tag);
  const numberOfFrames = numberOr(valueOf(NumberOfFrames), 1);
  if (numberOfFrames > 1 && sources.length > 1)
    throw new Error(
      'First chunk in a group of chunks (size > 1) is a multi-frame chunk'
    );
  return {
    rows: numberOr(valueOf(RowsTag), 0),
    columns: numberOr(valueOf(ColumnsTag), 0),
    samplesPerPixel: numberOr(valueOf(SamplesPerPixelTag), 1),
    slices:
      sources.length > 1
        ? Math.max(...reconstruction.slots) + 1
        : numberOfFrames,
  };
}

function allocationNotes(
  sources: readonly VolumeSource[],
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
    sources.length > 1 &&
    sources.some((source) =>
      readPixelSpacing(source.dataset).some(
        (axis) => axis.status === 'fallback'
      )
    )
  )
    notes.push(
      'Some slices lack usable PixelSpacing; the displayed in-plane grid uses the first slice.'
    );
  return notes;
}

function allocationCalibration(metadata: DicomDataset) {
  const type = getDatasetTag(metadata, '00280A02')?.trim();
  const description = getDatasetTag(metadata, '00280A04')?.trim();
  return type || description ? { calibration: { type, description } } : {};
}

function allocationSpatialMetadata(
  sources: readonly VolumeSource[],
  geometry: ReturnType<typeof allocationGeometry>
): SpatialMetadata {
  const metadata = sources[0].dataset;
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
    notes: allocationNotes(sources, geometry),
    ...allocationCalibration(metadata),
  };
}

/**
 * Shape, placement and element type of the volume these ordered members fill.
 * `origin` and `direction` are null where the headers cannot place the image.
 */
export function volumeLayout(
  sources: readonly VolumeSource[],
  orientation: number[] | null,
  reconstruction: Reconstruction,
  irregularGeometry: IrregularGeometryPolicy = 'preserve-order'
) {
  if (sources.length === 0)
    throw new Error('Cannot allocate an image from zero chunks');
  assertRegularGeometry(reconstruction, irregularGeometry);
  assertSliceSlots(reconstruction.slots, sources.length);
  const shape = allocationShape(sources, reconstruction);
  const geometry = allocationGeometry(
    sources,
    orientation,
    reconstruction,
    irregularGeometry
  );
  return {
    ...shape,
    origin: geometry.position,
    direction: geometry.direction,
    spatialMetadata: allocationSpatialMetadata(sources, geometry),
    bufferType: getVolumeBufferType(
      sources.flatMap((source) => instancePixelFormats(source.dataset))
    ),
  };
}

export type VolumeLayout = ReturnType<typeof volumeLayout>;

const reconstructionFor = (
  sources: readonly VolumeSource[],
  orientation: number[] | null,
  supplied: Reconstruction | undefined
) => {
  const needsFrameGeometry =
    sources.length === 1 && frameCountOf(sources[0].dataset) > 1;
  return supplied && !needsFrameGeometry
    ? supplied
    : reconstructInstances(
        sources.map((source) => readDatasetDetails(source.dataset).facts),
        sliceNormalOf(orientation),
        supplied
      );
};

/**
 * Plans an allocation for planned members. SEG yields no layout, since its
 * pixels are labels that a segmentation reader turns into its own image.
 */
export function planVolumeAllocation(
  sources: readonly VolumeSource[],
  orientation: number[] | null,
  supplied: Reconstruction | undefined,
  policy: IrregularGeometryPolicy
) {
  if (sources.length === 0)
    throw new Error('Cannot allocate an image from zero chunks');
  const reconstruction = reconstructionFor(sources, orientation, supplied);
  const warnings: Array<[string, string]> = [];
  if (getDatasetModality(sources[0].dataset) === 'SEG')
    return { kind: 'segmentation' as const, reconstruction, warnings };
  const layout = volumeLayout(sources, orientation, reconstruction, policy);
  const spatialMetadata = applyUltrasoundSpacing(
    layout.spatialMetadata,
    sources,
    (...warning) => warnings.push(warning)
  );
  return {
    kind: 'volume' as const,
    reconstruction,
    layout: { ...layout, spatialMetadata },
    warnings,
  };
}
