import type { DicomDataset } from '../metadata/dicomDataset';
import { getDatasetTag } from '../metadata/datasetAccess';
import { Tags } from '../metadata/dicomTags';
import { readGeometryFacts, sliceNormalOf } from '../collections/instanceFacts';
import type { Reconstruction } from '../collections/reconstructVolume';
import { readDatasetDetails } from '../collections/datasetDetails';
import { readPixelSpacing } from '../metadata/spatialMetadata';
import { getFrameTag } from '../metadata/functionalGroups';
import { frameCount } from '../pixels/pixelDecoder';
import { numberOr, trimDicomPadding } from '../utils';
import { nmGeometry } from './nmGeometry';
import {
  getVolumeBufferType,
  instancePixelFormats,
  paletteSampleBits,
} from './pixelFormat';
import { applyUltrasoundSpacing } from './ultrasoundSpacing';

/** What allocation reads from one member: its header. */
export type VolumeSource = { dataset: DicomDataset };

const isPositiveFiniteNumber = (value: number) =>
  Number.isFinite(value) && value > 0;

// One instance alone places its own frames: NM by its detector, an enhanced
// object by its functional groups.
const frameGeometry = (sources: readonly VolumeSource[]) => {
  if (sources.length !== 1) return { frames: null };
  const { dataset } = sources[0];
  const nm = nmGeometry(dataset);
  if (nm) return { frames: nm };
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
  const { frames } = frameGeometry(sources);
  const geometry = frames ?? readGeometryFacts(dataset);
  const effectiveOrientation = orientation ?? geometry.orientation;
  return {
    ...geometry,
    reconstruction: frames?.reconstruction ?? reconstruction,
    direction: allocationDirection(effectiveOrientation, frames?.direction),
  };
}

function allocationShape(sources: readonly VolumeSource[]) {
  const { dataset } = sources[0];
  const valueOf = (tag: string) => getDatasetTag(dataset, tag);
  return {
    rows: numberOr(valueOf(Tags.Rows), 0),
    columns: numberOr(valueOf(Tags.Columns), 0),
    samplesPerPixel: paletteSampleBits(dataset)
      ? 3
      : numberOr(valueOf(Tags.SamplesPerPixel), 1),
    slices: sources.length > 1 ? sources.length : frameCount(dataset),
  };
}

// SliceThickness is only a stand-in for the gap: it can differ from it, but
// many enhanced OCT files declare nothing else.
const declaredSliceSpacing = (dataset: DicomDataset) =>
  [Tags.SpacingBetweenSlices, Tags.SliceThickness]
    .map((tag) => Number(trimDicomPadding(getFrameTag(dataset, tag) ?? '')))
    .find(isPositiveFiniteNumber) ?? 1;

function allocationSpacing(
  dataset: DicomDataset,
  { reconstruction }: ReturnType<typeof allocationGeometry>
) {
  const sliceSpacing = reconstruction.sliceSpacing ?? 0;
  const z = isPositiveFiniteNumber(sliceSpacing)
    ? sliceSpacing
    : declaredSliceSpacing(dataset);
  return [...readPixelSpacing(dataset), z];
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
    spacing: allocationSpacing(sources[0].dataset, geometry),
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
  const { spacing, warnings } = applyUltrasoundSpacing(layout.spacing, sources);
  return { layout: { ...layout, spacing }, warnings };
}
