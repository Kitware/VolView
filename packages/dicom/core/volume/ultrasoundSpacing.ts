import { getDatasetModality } from '../metadata/datasetAccess';
import { unitToMm } from '../metadata/ultrasoundRegion';
import {
  physicalSpacing,
  type SpatialMetadata,
} from '../metadata/spatialMetadata';
import type { VolumeSource } from './volumeLayout';

const isUsableSpacing = (value: number) =>
  Number.isFinite(value) && value !== 0;

const regionNotes = (count: number) =>
  count > 1
    ? [
        'Multiple ultrasound regions are present; only the first region supplies the display spacing.',
      ]
    : [];

/** The display spacing is `axes[n].value` of the returned metadata; warnings are [title, details]. */
export function applyUltrasoundSpacing(
  spatialMetadata: SpatialMetadata,
  sources: readonly VolumeSource[]
): { spatialMetadata: SpatialMetadata; warnings: Array<[string, string]> } {
  const unchanged = { spatialMetadata, warnings: [] };
  if (getDatasetModality(sources[0].dataset) !== 'US') return unchanged;

  // Ultrasound DICOMs are typically a single multi-frame instance, so the
  // first region table applies to the whole image.
  const regions = sources[0].ultrasoundRegions;
  if (!regions?.region) return unchanged;

  const { region } = regions;
  const notes = [...spatialMetadata.notes, ...regionNotes(regions.regionCount)];
  const xFactor = unitToMm(region.physicalUnitsXDirection);
  const yFactor = unitToMm(region.physicalUnitsYDirection);
  // All-or-nothing: if either axis lacks a spatial unit (e.g. one axis is
  // cm and the other is seconds, or unitless) the metadata can't be trusted
  // as a 2D physical spacing, so leave the default 1mm fallback in place.
  if (xFactor === null || yFactor === null) {
    notes.push(
      'The first ultrasound region does not declare two spatial axes; its calibration is not applied.'
    );
    return { spatialMetadata: { ...spatialMetadata, notes }, warnings: [] };
  }

  const spacingX = region.physicalDeltaX * xFactor;
  const spacingY = region.physicalDeltaY * yFactor;
  if (!isUsableSpacing(spacingX) || !isUsableSpacing(spacingY)) {
    notes.push(
      'The first ultrasound region has unusable physical deltas; its calibration is not applied.'
    );
    return {
      spatialMetadata: { ...spatialMetadata, notes },
      warnings: [
        [
          'Invalid ultrasound calibration',
          `The ultrasound region declares PhysicalDeltaX=${region.physicalDeltaX} and PhysicalDeltaY=${region.physicalDeltaY}. Measurements use the image pixel spacing instead.`,
        ],
      ],
    };
  }

  notes.push(
    'Ultrasound physical spacing applies within the calibrated region, not necessarily the entire image.'
  );
  return {
    spatialMetadata: {
      ...spatialMetadata,
      axes: [
        physicalSpacing(spacingX, 'Ultrasound region (cm converted to mm)'),
        physicalSpacing(spacingY, 'Ultrasound region (cm converted to mm)'),
        spatialMetadata.axes[2],
      ],
      notes,
    },
    warnings: [],
  };
}
