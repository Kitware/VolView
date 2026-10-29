import medicalPresets from '@/src/vtk/MedicalColorPresets.json';
import { DEFAULT_ADAPTIVE_VOLUME_PRESET } from '@/src/utils/adaptiveVolumePreset';
import { DEFAULT_PRESET_BY_MODALITY } from '@/src/config';

type DefaultVolumePresetInput = {
  nativeModality?: string;
  metadata?: Iterable<readonly [string, string]>;
  numberOfComponents?: number;
  scalarRange?: readonly [number, number];
  fallbackPreset: string;
};

function getDeclaredModality({
  nativeModality,
  metadata = [],
}: Pick<DefaultVolumePresetInput, 'nativeModality' | 'metadata'>) {
  const fields = new Map(
    Array.from(metadata, ([key, value]) => [
      key.trim().toLowerCase(),
      value.trim().toUpperCase(),
    ])
  );
  const modality =
    nativeModality?.trim().toUpperCase() ||
    fields.get('0008|0060') ||
    fields.get('modality');
  if (modality) return modality;

  // Scalar units identify HU; spatial units and intensity ranges do not.
  const units =
    fields.get('0028|1054') ||
    fields.get('rescaletype') ||
    fields.get('intensityunits');
  return units && ['HU', 'HOUNSFIELD UNIT', 'HOUNSFIELD UNITS'].includes(units)
    ? 'CT'
    : '';
}

function opacityAt(points: number[], value: number) {
  if (value <= points[0]) return points[1];
  for (let index = 2; index < points.length; index += 2) {
    if (value <= points[index]) {
      const weight =
        (value - points[index - 2]) / (points[index] - points[index - 2]);
      return points[index - 1] * (1 - weight) + points[index + 1] * weight;
    }
  }
  return points[points.length - 1];
}

function hasVisibleOpacity(points: number[], range: readonly [number, number]) {
  if (range.some((value) => opacityAt(points, value) > 0)) return true;
  return points.some(
    (value, index) =>
      index % 2 === 0 &&
      value >= range[0] &&
      value <= range[1] &&
      points[index + 1] > 0
  );
}

export function getConventionalVolumePreset(
  input: Pick<
    DefaultVolumePresetInput,
    'nativeModality' | 'metadata' | 'fallbackPreset'
  >
) {
  return (
    DEFAULT_PRESET_BY_MODALITY[getDeclaredModality(input)] ??
    input.fallbackPreset
  );
}

export function getDefaultVolumePreset(input: DefaultVolumePresetInput) {
  const { numberOfComponents, scalarRange, fallbackPreset } = input;
  if (
    numberOfComponents !== 1 ||
    !scalarRange ||
    !scalarRange.every(Number.isFinite) ||
    scalarRange[0] > scalarRange[1]
  )
    return fallbackPreset;

  const presetName = DEFAULT_PRESET_BY_MODALITY[getDeclaredModality(input)];
  if (!presetName) return DEFAULT_ADAPTIVE_VOLUME_PRESET;

  const preset = medicalPresets.find(({ Name }) => Name === presetName);
  // Absolute presets can be fully transparent for normalized or rescaled data.
  if (
    preset?.AbsoluteRange &&
    preset.OpacityPoints &&
    !hasVisibleOpacity(preset.OpacityPoints, scalarRange)
  )
    return DEFAULT_ADAPTIVE_VOLUME_PRESET;
  return presetName;
}
