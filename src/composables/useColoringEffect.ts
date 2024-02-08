import { useProxyManager } from '@/src/composables/useProxyManager';
import { Maybe } from '@/src/types';
import { ColoringConfig } from '@/src/types/views';
import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { Ref, computed, watch } from 'vue';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { getShiftedOpacityFromPreset } from '@/src/utils/vtk-helpers';

export function useColoringEffect(
  config: Ref<Maybe<ColoringConfig>>,
  imageRep: Ref<Maybe<vtkVolumeRepresentationProxy>>,
  viewProxy: Ref<vtkLPSView3DProxy>
) {
  const colorBy = computed(() => config.value?.colorBy);
  const colorTransferFunction = computed(() => config.value?.transferFunction);
  const opacityFunction = computed(() => config.value?.opacityFunction);

  const proxyManager = useProxyManager();

  watch(
    [imageRep, colorBy, colorTransferFunction, opacityFunction],
    ([rep, colorBy_, colorFunc, opacityFunc]) => {
      if (!rep || !colorBy_ || !colorFunc || !opacityFunc || !proxyManager) {
        return;
      }

      const { arrayName, location } = colorBy_;

      const lut = proxyManager.getLookupTable(arrayName);
      lut.setMode(LookupTableProxyMode.Preset);
      lut.setPresetName(colorFunc.preset);
      lut.setDataRange(...colorFunc.mappingRange);

      const pwf = proxyManager.getPiecewiseFunction(arrayName);
      pwf.setMode(opacityFunc.mode);
      pwf.setDataRange(...opacityFunc.mappingRange);

      switch (opacityFunc.mode) {
        case vtkPiecewiseFunctionProxy.Mode.Gaussians:
          pwf.setGaussians(opacityFunc.gaussians);
          break;
        case vtkPiecewiseFunctionProxy.Mode.Points: {
          const opacityPoints = getShiftedOpacityFromPreset(
            opacityFunc.preset,
            opacityFunc.mappingRange,
            opacityFunc.shift,
            opacityFunc.shiftAlpha
          );
          if (opacityPoints) {
            pwf.setPoints(opacityPoints);
          }
          break;
        }
        case vtkPiecewiseFunctionProxy.Mode.Nodes:
          pwf.setNodes(opacityFunc.nodes);
          break;
        default:
      }

      if (rep) {
        // control color range manually
        rep.setRescaleOnColorBy(false);
        rep.setColorBy(arrayName, location);
      }

      // Need to trigger a render for when we are restoring from a state file
      viewProxy.value.renderLater();
    },
    { immediate: true }
  );
}
