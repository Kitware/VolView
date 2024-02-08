import { useProxyManager } from '@/src/composables/useProxyManager';
import { Maybe } from '@/src/types';
import {
  ColorBy,
  ColorTransferFunction,
  ColoringConfig,
  OpacityFunction,
} from '@/src/types/views';
import vtkLPSView3DProxy from '@/src/vtk/LPSView3DProxy';
import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import { Mode as LookupTableProxyMode } from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import { Ref, computed, watchEffect } from 'vue';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import { getShiftedOpacityFromPreset } from '@/src/utils/vtk-helpers';
import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';

export interface ApplyColoringParams {
  colorBy: ColorBy;
  colorFunc: ColorTransferFunction;
  opacityFunc: OpacityFunction;
  rep: vtkAbstractRepresentationProxy;
  proxyManager: vtkProxyManager;
}

export function applyColoring({
  colorBy,
  colorFunc,
  opacityFunc,
  rep,
  proxyManager,
}: ApplyColoringParams) {
  const { arrayName, location } = colorBy;

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

  // control color range manually
  rep.setRescaleOnColorBy(false);
  rep.setColorBy(arrayName, location);
}

export function useColoringEffect(
  config: Ref<Maybe<ColoringConfig>>,
  imageRep: Ref<Maybe<vtkVolumeRepresentationProxy>>,
  viewProxy: Ref<vtkLPSView3DProxy>
) {
  const colorBy = computed(() => config.value?.colorBy);
  const colorTransferFunction = computed(() => config.value?.transferFunction);
  const opacityFunction = computed(() => config.value?.opacityFunction);

  const proxyManager = useProxyManager();

  watchEffect(() => {
    const rep = imageRep.value;
    const colorBy_ = colorBy.value;
    const colorFunc = colorTransferFunction.value;
    const opacityFunc = opacityFunction.value;
    if (!rep || !colorBy_ || !colorFunc || !opacityFunc || !proxyManager) {
      return;
    }

    applyColoring({
      colorBy: colorBy_,
      colorFunc,
      opacityFunc,
      rep,
      proxyManager,
    });

    // Need to trigger a render for when we are restoring from a state file
    viewProxy.value.renderLater();
  });
}
