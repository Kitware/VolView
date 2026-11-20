import { getDatasetModality } from '../metadata/datasetAccess';
import { readUltrasoundRegions, unitToMm } from '../metadata/ultrasoundRegion';
import type { VolumeSource } from './volumeLayout';

const isUsableSpacing = (value: number) =>
  Number.isFinite(value) && value !== 0;

/** Display spacing from the first ultrasound region; warnings are [title, details]. */
export function applyUltrasoundSpacing(
  spacing: number[],
  sources: readonly VolumeSource[]
): { spacing: number[]; warnings: Array<[string, string]> } {
  const unchanged = { spacing, warnings: [] };
  if (getDatasetModality(sources[0].dataset) !== 'US') return unchanged;

  // Ultrasound DICOMs are typically a single multi-frame instance, so the
  // first region table applies to the whole image.
  const { region } = readUltrasoundRegions(sources[0].dataset);
  if (!region) return unchanged;

  const xFactor = unitToMm(region.physicalUnitsXDirection);
  const yFactor = unitToMm(region.physicalUnitsYDirection);
  // All-or-nothing: if either axis lacks a spatial unit (e.g. one axis is
  // cm and the other is seconds, or unitless) the metadata can't be trusted
  // as a 2D physical spacing, so leave the default 1mm fallback in place.
  if (xFactor === null || yFactor === null) return unchanged;

  const spacingX = region.physicalDeltaX * xFactor;
  const spacingY = region.physicalDeltaY * yFactor;
  if (!isUsableSpacing(spacingX) || !isUsableSpacing(spacingY))
    return {
      spacing,
      warnings: [
        [
          'Invalid ultrasound calibration',
          `The ultrasound region declares PhysicalDeltaX=${region.physicalDeltaX} and PhysicalDeltaY=${region.physicalDeltaY}. Measurements use the image pixel spacing instead.`,
        ],
      ],
    };

  return { spacing: [spacingX, spacingY, spacing[2]], warnings: [] };
}
