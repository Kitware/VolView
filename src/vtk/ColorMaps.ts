import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import MedicalPresets from '@/src/vtk/MedicalColorPresets.json';

function registerPresets(presets: typeof MedicalPresets) {
  for (let i = 0; i < presets.length; i += 1) {
    vtkColorMaps.addPreset(presets[i]);
  }
}

registerPresets(MedicalPresets);

const twoHotOpaque = {
  ...vtkColorMaps.getPresetByName('2hot'),
  Name: '2hot-opaque',
  OpacityPoints: [0, 1],
};
vtkColorMaps.addPreset(twoHotOpaque);

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
];

export const PresetNameList = GroupedPresets.flatMap((group) => group.presets);
export default GroupedPresets;
