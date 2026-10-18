export const DEFAULT_LAYER_PRESET = 'DICOM Hot Iron';

export const LAYER_PRESET_OPTIONS = [
  { title: 'Grayscale', value: 'Grayscale' },
  { title: 'Inverted grayscale', value: 'Inverted-Grayscale' },
  { title: 'DICOM Hot Iron', value: 'DICOM Hot Iron' },
  { title: 'DICOM PET', value: 'DICOM PET' },
  { title: 'DICOM Hot Metal Blue', value: 'DICOM Hot Metal Blue' },
  { title: 'DICOM Spring', value: 'DICOM Spring' },
  { title: 'DICOM Winter', value: 'DICOM Winter' },
  { title: 'Viridis', value: 'Viridis (matplotlib)' },
  { title: 'Cool to Warm', value: 'Cool to Warm' },
];

export const resolveBaseColorPreset = (preset?: string) =>
  LAYER_PRESET_OPTIONS.find(({ value }) => value === preset)?.value ??
  'Grayscale';

export const resolveLayerColorPreset = (preset?: string) =>
  LAYER_PRESET_OPTIONS.find(({ value }) => value === preset)?.value ??
  DEFAULT_LAYER_PRESET;
