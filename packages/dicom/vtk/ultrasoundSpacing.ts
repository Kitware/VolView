import {
  type Chunk,
  getChunkTag,
  unitToMm,
  physicalSpacing,
  type SpatialMetadata,
} from '../core/index';
import type { allocateImageFromChunks } from './allocateImageFromChunks';

const isUsableSpacing = (value: number) =>
  Number.isFinite(value) && value !== 0;

const regionNotes = (count: number) =>
  count > 1
    ? [
        'Multiple ultrasound regions are present; only the first region supplies the display spacing.',
      ]
    : [];

export function applyUltrasoundSpacing(
  allocation: ReturnType<typeof allocateImageFromChunks>,
  chunks: Chunk[],
  warn: (title: string, details: string) => void
): SpatialMetadata {
  const { image, spatialMetadata } = allocation;
  if (getChunkTag(chunks[0], '00080060')?.trim() !== 'US')
    return spatialMetadata;

  // Ultrasound DICOMs are typically a single multi-frame chunk, so the
  // region table on chunk[0] applies to the whole image. If a US series
  // ever spanned multiple chunks with differing regions, this would
  // silently use the first chunk's spacing for all of them.
  const regions = chunks[0]?.ultrasoundRegions;
  if (!regions?.region) return spatialMetadata;

  warnMultipleRegions(regions.regionCount);

  const { region } = regions;
  const notes = [...spatialMetadata.notes, ...regionNotes(regions.regionCount)];
  const xFactor = unitToMm(region.physicalUnitsXDirection);
  const yFactor = unitToMm(region.physicalUnitsYDirection);
  // All-or-nothing: if either axis lacks a spatial unit (e.g. one axis is
  // cm and the other is seconds, or unitless) the metadata can't be trusted
  // as a 2D physical spacing, so leave the default 1mm fallback in place.
  if (xFactor === null || yFactor === null) {
    console.warn(
      `Ultrasound spacing not applied: PhysicalUnitsXDirection=${region.physicalUnitsXDirection}, PhysicalUnitsYDirection=${region.physicalUnitsYDirection}; only code 3 (cm) is converted to mm.`
    );
    notes.push(
      'The first ultrasound region does not declare two spatial axes; its calibration is not applied.'
    );
    return { ...spatialMetadata, notes };
  }

  const spacingX = region.physicalDeltaX * xFactor;
  const spacingY = region.physicalDeltaY * yFactor;
  if (!isUsableSpacing(spacingX) || !isUsableSpacing(spacingY)) {
    warn(
      'Invalid ultrasound calibration',
      `The ultrasound region declares PhysicalDeltaX=${region.physicalDeltaX} and PhysicalDeltaY=${region.physicalDeltaY}. Measurements use the image pixel spacing instead.`
    );
    notes.push(
      'The first ultrasound region has unusable physical deltas; its calibration is not applied.'
    );
    return { ...spatialMetadata, notes };
  }

  const [, , zSpacing] = image.getSpacing();
  image.setSpacing([spacingX, spacingY, zSpacing]);
  notes.push(
    'Ultrasound physical spacing applies within the calibrated region, not necessarily the entire image.'
  );
  return {
    ...spatialMetadata,
    axes: [
      physicalSpacing(spacingX, 'Ultrasound region (cm converted to mm)'),
      physicalSpacing(spacingY, 'Ultrasound region (cm converted to mm)'),
      spatialMetadata.axes[2],
    ],
    notes,
  };
}

function warnMultipleRegions(count: number) {
  // vtkImageData has one global spacing even when the acquisition contains
  // regions with different physical calibration.
  if (count > 1)
    console.warn(
      `Ultrasound image has ${count} regions; only the first region's physical spacing is applied. Multi-region (e.g. dual-pane B-mode + Doppler) ultrasound is not fully supported.`
    );
}
