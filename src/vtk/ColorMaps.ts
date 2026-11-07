import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import { ColorMapPreset } from '@/src/types/color-map-preset';
import { ADAPTIVE_VOLUME_PRESETS } from '../utils/adaptiveVolumePresets';
import MedicalPresets from './MedicalColorPresets.json';
import DicomPresets from './DicomColorPresets.json';

MedicalPresets.forEach((preset) =>
  vtkColorMaps.addPreset(preset as ColorMapPreset)
);
vtkColorMaps.addPreset({
  ...vtkColorMaps.getPresetByName('2hot'),
  Name: '2hot-opaque',
  OpacityPoints: [0, 1],
} as ColorMapPreset);
// DICOM PS3.6 Annex B: https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_B.html
DicomPresets.forEach((preset) =>
  vtkColorMaps.addPreset(preset as ColorMapPreset)
);

ADAPTIVE_VOLUME_PRESETS.forEach((name) => {
  const preset = vtkColorMaps.getPresetByName('Grayscale');
  if (preset) vtkColorMaps.addPreset({ ...preset, Name: name });
});

/* prettier-ignore */
const GroupedPresets = [
  { group: 'Adaptive', presets: [...ADAPTIVE_VOLUME_PRESETS] },
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
];

export const PresetNameList = GroupedPresets.flatMap((group) => group.presets);
