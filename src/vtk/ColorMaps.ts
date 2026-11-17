import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import { ColorMapPreset } from '@/src/types/color-map-preset';
import MedicalPresets from './MedicalColorPresets.json';
import DicomPresets from './DicomColorPresets.json';

function colorAt(points: number[][], x: number) {
  const next = points.findIndex(([px]) => px >= x);
  if (next <= 0) return (next === 0 ? points[0] : points.at(-1)!).slice(1);
  const [x0, ...c0] = points[next - 1];
  const [x1, ...c1] = points[next];
  return c0.map((c, i) => c + ((c1[i] - c) * (x - x0)) / (x1 - x0));
}

// MR intensities have no standard scale, so an MR preset's effective range
// maps onto each image's fitted range instead of fixed scalar values.
function toRelativePreset(preset: ColorMapPreset): ColorMapPreset {
  const [low, high] = preset.EffectiveRange ?? [0, 1];
  const toUnit = (x: number) => (x - low) / (high - low);
  const flat = preset.RGBPoints ?? [];
  const rgb = Array.from({ length: flat.length / 4 }, (_, i) => {
    const [x, ...color] = flat.slice(4 * i, 4 * i + 4);
    return [toUnit(x), ...color];
  });
  // Clipping to [0, 1] makes the color mapping range exactly the fitted range.
  const inside = rgb.filter(([x]) => x > 0 && x < 1);
  return {
    ...preset,
    AbsoluteRange: false,
    EffectiveRange: undefined,
    RGBPoints: [
      [0, ...colorAt(rgb, 0)],
      ...inside,
      [1, ...colorAt(rgb, 1)],
    ].flat(),
    OpacityPoints: preset.OpacityPoints?.map((value, index) =>
      index % 2 === 0 ? toUnit(value) : value
    ),
  };
}

MedicalPresets.forEach((preset) =>
  vtkColorMaps.addPreset(
    preset.Name.startsWith('MR-')
      ? toRelativePreset(preset as ColorMapPreset)
      : (preset as ColorMapPreset)
  )
);
vtkColorMaps.addPreset({
  ...vtkColorMaps.getPresetByName('Grayscale'),
  OpacityPoints: [0, 0, 1, 1],
} as ColorMapPreset);
vtkColorMaps.addPreset({
  ...vtkColorMaps.getPresetByName('2hot'),
  Name: '2hot-opaque',
  OpacityPoints: [0, 1],
} as ColorMapPreset);
// DICOM PS3.6 Annex B: https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_B.html
DicomPresets.forEach((preset) =>
  vtkColorMaps.addPreset(preset as ColorMapPreset)
);

/* prettier-ignore */
const GroupedPresets = [
  {
    group: 'CT',
    presets: [
      'CT-AAA',
      'CT-AAA2',
      'CT-Bone',
      'CT-Bones',
      'CT-Cardiac',
      'CT-Cardiac2',
      'CT-Cardiac3',
      'CT-Chest-Contrast-Enhanced',
      'CT-Chest-Vessels',
      'CT-Coronary-Arteries',
      'CT-Coronary-Arteries-2',
      'CT-Coronary-Arteries-3',
      'CT-Cropped-Volume-Bone',
      'CT-Fat',
      'CT-Liver-Vasculature',
      'CT-Lung',
      'CT-MIP',
      'CT-Muscle',
      'CT-Pulmonary-Arteries',
      'CT-Soft-Tissue',
      'CT-Air',
      'CT-X-ray',
    ],
  },
  {
    group: 'MR',
    presets: [
      'MR-Default',
      'MR-Angio',
      'MR-MIP',
      'MR-T2-Brain',
    ],
  },
  {
    group: 'DTI',
    presets: [
      'DTI-FA-Brain',
    ],
  },
  {
    group: 'US',
    presets: [
      'US-Fetal',
    ],
  },
  {
    group: 'Generic',
    presets: [
      'Grayscale',
    ],
  },
];

export const PresetNameList = GroupedPresets.flatMap((group) => group.presets);
