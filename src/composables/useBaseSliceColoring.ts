import { MaybeRef, onScopeDispose, unref, watchEffect } from 'vue';
import vtkImageProperty from '@kitware/vtk.js/Rendering/Core/ImageProperty';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import { resolveBaseColorPreset } from '@/src/vtk/LayerColorPresets';

export function useBaseSliceColoring(
  property: vtkImageProperty,
  preset: MaybeRef<string | undefined>,
  enabled: MaybeRef<boolean>,
  requestRender: () => void
) {
  const colors = vtkColorTransferFunction.newInstance();
  onScopeDispose(() => colors.delete());

  watchEffect(() => {
    const name = resolveBaseColorPreset(unref(preset));
    if (!unref(enabled) || name === 'Grayscale') {
      property.setRGBTransferFunction(0, null);
    } else {
      colors.applyColorMap(vtkColorMaps.getPresetByName(name)!);
      colors.setMappingRange(0, 1);
      colors.updateRange();
      property.setRGBTransferFunction(0, colors);
    }
    // The image property's window/level maps scalar values onto the palette.
    property.setUseLookupTableScalarRange(false);
    requestRender();
  });
}
