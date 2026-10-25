import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { type Chunk, getChunkTag, unitToMm } from '../core/index';

const isUsableSpacing = (value: number) =>
  Number.isFinite(value) && value !== 0;

export function applyUltrasoundSpacing(
  image: vtkImageData,
  chunks: Chunk[],
  warn: (title: string, details: string) => void
) {
  if (getChunkTag(chunks[0], '00080060')?.trim() !== 'US') return;

  // Ultrasound DICOMs are typically a single multi-frame chunk, so the
  // region table on chunk[0] applies to the whole image. If a US series
  // ever spanned multiple chunks with differing regions, this would
  // silently use the first chunk's spacing for all of them.
  const regions = chunks[0]?.ultrasoundRegions;
  if (!regions?.region) return;

  warnMultipleRegions(regions.regionCount);

  const { region } = regions;
  const xFactor = unitToMm(region.physicalUnitsXDirection);
  const yFactor = unitToMm(region.physicalUnitsYDirection);
  // All-or-nothing: if either axis lacks a spatial unit (e.g. one axis is
  // cm and the other is seconds, or unitless) the metadata can't be trusted
  // as a 2D physical spacing, so leave the default 1mm fallback in place.
  if (xFactor === null || yFactor === null) {
    console.warn(
      `Ultrasound spacing not applied: PhysicalUnitsXDirection=${region.physicalUnitsXDirection}, PhysicalUnitsYDirection=${region.physicalUnitsYDirection}; only code 3 (cm) is converted to mm.`
    );
    return;
  }

  const spacingX = region.physicalDeltaX * xFactor;
  const spacingY = region.physicalDeltaY * yFactor;
  if (!isUsableSpacing(spacingX) || !isUsableSpacing(spacingY)) {
    warn(
      'Invalid ultrasound calibration',
      `The ultrasound region declares PhysicalDeltaX=${region.physicalDeltaX} and PhysicalDeltaY=${region.physicalDeltaY}. Measurements use the image pixel spacing instead.`
    );
    return;
  }

  const [, , zSpacing] = image.getSpacing();
  image.setSpacing([spacingX, spacingY, zSpacing]);
}

function warnMultipleRegions(count: number) {
  // vtkImageData has one global spacing even when the acquisition contains
  // regions with different physical calibration.
  if (count > 1)
    console.warn(
      `Ultrasound image has ${count} regions; only the first region's physical spacing is applied. Multi-region (e.g. dual-pane B-mode + Doppler) ultrasound is not fully supported.`
    );
}
