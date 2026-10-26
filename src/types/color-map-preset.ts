import vtkColorMaps, {
  IColorMapPreset,
} from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

// vtk.js retains the extra opacity/range metadata on VolView's medical presets.
export type ColorMapPreset = IColorMapPreset & {
  /** Flattened (x, opacity) pairs. */
  OpacityPoints?: number[];
  /** Whether RGBPoints use absolute scalar units. */
  AbsoluteRange?: boolean;
  EffectiveRange?: [number, number];
};

export function getPresetByName(name: string) {
  return vtkColorMaps.getPresetByName(name) as ColorMapPreset | undefined;
}
