import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import MedicalPresets from '@/src/vtk/MedicalColorPresets.json';

function registerPresets(presets: typeof MedicalPresets) {
  for (let i = 0; i < presets.length; i += 1) {
    vtkColorMaps.addPreset(presets[i]);
  }
}

registerPresets(MedicalPresets);

/* prettier-ignore */
const GroupedPresets = [
  {
    group: 'Other',
    presets: [
      'Cool to Warm',
    ],
  },
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
];

export const DEFAULT_PRESET = 'Cool to Warm';
export const PresetNameList = GroupedPresets.flatMap((group) => group.presets);
export default GroupedPresets;
