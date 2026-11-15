import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { readGeometryFacts, sliceNormalOf } from '../collections/instanceFacts';
import type { Reconstruction } from '../collections/reconstructVolume';
import { readDatasetDetails } from '../collections/datasetDetails';
import {
  declaredSpacing,
  physicalSpacing,
  readPixelSpacing,
  type SpatialMetadata,
} from '../metadata/spatialMetadata';
import { getFrameTag } from '../metadata/functionalGroups';
import type { UltrasoundRegions } from '../metadata/ultrasoundRegion';
import { frameCount } from '../pixels/pixelDecoder';
import { numberOr } from '../utils';
import { nmGeometry } from './nmGeometry';
import { getVolumeBufferType, instancePixelFormats } from './pixelFormat';
import { applyUltrasoundSpacing } from './ultrasoundSpacing';

/** What allocation reads from one member: its header and ultrasound regions. */
export type VolumeSource = {
  dataset: DicomDataset;
  ultrasoundRegions?: UltrasoundRegions | null;
};

const isPositiveFiniteNumber = (value: number) =>
  Number.isFinite(value) && value > 0;

// One instance alone places its own frames: NM by its detector, an enhanced
// object by its functional groups.
const frameGeometry = (sources: readonly VolumeSource[]) => {
  if (sources.length !== 1) return { frames: null };
  const { dataset } = sources[0];
  const nm = nmGeometry(dataset);
  if (nm) return { frames: nm, sliceSpacingSource: nm.sliceSpacingSource };
  return {
    frames:
      frameCount(dataset) < 2
        ? null
        : readDatasetDetails(dataset).frameGeometry,
  };
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
  reconstruction: Reconstruction
) {
  const { dataset } = sources[0];
  const { frames, sliceSpacingSource = 'ImagePositionPatient' } =
    frameGeometry(sources);
  const geometry = frames ?? readGeometryFacts(dataset);
  const effectiveOrientation = orientation ?? geometry.orientation;
  return {
    ...geometry,
    reconstruction: frames?.reconstruction ?? reconstruction,
    sliceSpacingSource,
    direction: allocationDirection(effectiveOrientation, frames?.direction),
  };
}

function allocationShape(sources: readonly VolumeSource[]) {
  const { dataset } = sources[0];
  const valueOf = (tag: string) => getDatasetTag(dataset, tag);
  return {
    rows: numberOr(valueOf(Tags.Rows), 0),
    columns: numberOr(valueOf(Tags.Columns), 0),
    samplesPerPixel: numberOr(valueOf(Tags.SamplesPerPixel), 1),
    slices: sources.length > 1 ? sources.length : frameCount(dataset),
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
        getFrameTag(metadata, Tags.SpacingBetweenSlices),
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
  reconstruction: Reconstruction
) {
  if (sources.length === 0)
    throw new Error('Cannot allocate an image from zero instances');
  const shape = allocationShape(sources);
  const geometry = allocationGeometry(sources, orientation, reconstruction);
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

/** Lays out the planned members of an image collection, with allocation warnings. */
export function planVolumeAllocation(
  sources: readonly VolumeSource[],
  orientation: number[] | null,
  reconstruction: Reconstruction
) {
  const layout = volumeLayout(sources, orientation, reconstruction);
  const { spatialMetadata, warnings } = applyUltrasoundSpacing(
    layout.spatialMetadata,
    sources
  );
  return { layout: { ...layout, spatialMetadata }, warnings };
}
