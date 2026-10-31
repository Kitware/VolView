export const ADAPTIVE_VOLUME_PRESETS = [
  'Adaptive-Transparent',
  'Adaptive-Balanced',
  'Adaptive-Surface',
] as const;

export const DEFAULT_ADAPTIVE_VOLUME_PRESET = 'Adaptive-Balanced';

type AdaptiveVolumePreset = (typeof ADAPTIVE_VOLUME_PRESETS)[number];

export const ADAPTIVE_VOLUME_PROFILES = {
  'Adaptive-Transparent': {
    opticalDepth: -Math.log(0.6),
    maximumOpacity: 0.12,
    description: 'Lower opacity to reveal overlapping structures',
  },
  'Adaptive-Balanced': {
    opticalDepth: -Math.log(0.25),
    maximumOpacity: 0.25,
    description: 'A general starting view fitted to the data',
  },
  'Adaptive-Surface': {
    opticalDepth: -Math.log(0.05),
    maximumOpacity: 0.6,
    description: 'Higher opacity to emphasize front-facing bright structures',
  },
};

export function isAdaptiveVolumePreset(
  preset: string
): preset is AdaptiveVolumePreset {
  return ADAPTIVE_VOLUME_PRESETS.some((name) => name === preset);
}

export function getAdaptiveVolumePresetDescription(preset: string) {
  return isAdaptiveVolumePreset(preset)
    ? ADAPTIVE_VOLUME_PROFILES[preset].description
    : '';
}
