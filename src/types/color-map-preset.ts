import vtkColorMaps, {
  IColorMapPreset,
} from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';

/**
 * A vtk.js color map preset carrying the extra opacity/range metadata VolView
 * attaches to its own medical presets.
 *
 * vtk.js stores presets verbatim, so these fields survive a round trip through
 * `addPreset`/`getPresetByName`; they are just not part of vtk.js's own type.
 */
export interface ColorMapPreset extends IColorMapPreset {
  /** Flattened (x, opacity) pairs. */
  OpacityPoints?: number[];
  /** Whether RGBPoints are in absolute scalar units rather than normalized. */
  AbsoluteRange?: boolean;
  /** Preferred scalar opacity mapping range. */
  EffectiveRange?: [number, number];
}

/**
 * `vtkColorMaps.getPresetByName` narrowed to VolView's preset shape.
 */
export function getPresetByName(name: string): ColorMapPreset {
  return vtkColorMaps.getPresetByName(name) as ColorMapPreset;
}
