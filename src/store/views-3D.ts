import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPiecewiseFunctionProxy, {
  IPiecewiseFunctionProxyMode,
  PiecewiseGaussian,
  PiecewiseNode,
} from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { defineStore } from 'pinia';
import { ViewProxyType } from '../core/proxies';
import { DEFAULT_PRESET } from '../vtk/ColorMaps';

export interface ColorBy {
  arrayName: string;
  location: string;
}

export interface OpacityGaussians {
  mode: IPiecewiseFunctionProxyMode.Gaussians;
  gaussians: PiecewiseGaussian[];
  mappingRange: [number, number];
}

export interface OpacityPoints {
  mode: IPiecewiseFunctionProxyMode.Points;
  // base preset that has the opacity points
  preset: string;
  shift: number;
  mappingRange: [number, number];
}

export interface OpacityNodes {
  mode: IPiecewiseFunctionProxyMode.Nodes;
  nodes: PiecewiseNode[];
  mappingRange: [number, number];
}

export type OpacityFunction = OpacityGaussians | OpacityPoints | OpacityNodes;

export interface ColorTransferFunction {
  preset: string;
  mappingRange: [number, number];
}
export interface ColoringConfig {
  colorBy: ColorBy;
  transferFunction: ColorTransferFunction;
  opacityFunction: OpacityFunction;
}

export interface CVRConfig {
  enabled: boolean;

  useVolumetricScatteringBlending: boolean;
  volumetricScatteringBlending: number;

  useLocalAmbientOcclusion: boolean;
  laoKernelSize: number;
  laoKernelRadius: number;
  ambient: number;
  diffuse: number;
  specular: number;
}

interface State {
  coloringConfig: ColoringConfig;
  cvrConfig: CVRConfig;
  views: string[];
}

export function getShiftedOpacityFromPreset(presetName: string, shift: number) {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    const OpacityPoints = preset.OpacityPoints as number[];
    const points = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      xmin = Math.min(xmin, OpacityPoints[i]);
      xmax = Math.max(xmax, OpacityPoints[i]);
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const width = xmax - xmin;
    return points.map(([x, y]) => [(x - xmin) / width + shift, y]);
  }
  return null;
}

export function getOpacityFunctionFromPreset(
  presetName: string
): Partial<OpacityFunction> {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    return {
      mode: vtkPiecewiseFunctionProxy.Mode.Points,
      preset: presetName,
      shift: 0,
      mappingRange: [0, 1],
    };
  }
  return {
    mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
    // deep-copy necessary
    gaussians: JSON.parse(
      JSON.stringify(vtkPiecewiseFunctionProxy.Defaults.Gaussians)
    ),
  };
}

export const useView3DStore = defineStore('view3D', {
  state: (): State => ({
    views: [],
    coloringConfig: {
      colorBy: {
        arrayName: '',
        location: '',
      },
      transferFunction: {
        preset: '',
        mappingRange: [0, 1],
      },
      opacityFunction: {
        mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
        gaussians: [],
        mappingRange: [0, 1],
      },
    },
    cvrConfig: {
      enabled: false,
      useVolumetricScatteringBlending: false,
      volumetricScatteringBlending: 0.5,
      useLocalAmbientOcclusion: false,
      laoKernelSize: 5,
      laoKernelRadius: 10,
      ambient: 0.3,
      diffuse: 1,
      specular: 0,
    },
  }),
  actions: {
    createView<T extends vtkViewProxy>() {
      const id = this.$id.nextID();
      this.views.push(id);
      return {
        id,
        proxy: <T>this.$proxies.createView(id, ViewProxyType.Volume),
      };
    },
    removeView(id: string) {
      const idx = this.views.indexOf(id);
      if (idx > -1) {
        this.views.splice(idx, 1);
      }
      this.$proxies.removeView(id);
    },
    setColorBy(arrayName: string, location: string) {
      this.coloringConfig.colorBy = {
        arrayName,
        location,
      };
    },
    /**
     * Sets the colorBy to be the default point scalars.
     * @param image
     */
    setDefaultColorByFromImage(image: vtkImageData) {
      const scalars = image.getPointData().getScalars();
      this.setColorBy(scalars.getName(), 'pointData');
    },
    updateColorTransferFunction(tf: Partial<ColorTransferFunction>) {
      // eslint-disable-next-line prefer-object-spread
      this.coloringConfig.transferFunction = Object.assign(
        {},
        this.coloringConfig.transferFunction,
        tf
      );
    },
    resetToDefaultColoring(image: vtkImageData) {
      const mappingRange = image.getPointData().getScalars().getRange();
      this.setDefaultColorByFromImage(image);
      this.updateColorTransferFunction({
        preset: DEFAULT_PRESET,
        mappingRange,
      });
      this.updateOpacityFunction({
        ...getOpacityFunctionFromPreset(DEFAULT_PRESET),
        mappingRange,
      });
    },
    updateOpacityFunction(opacityFunc: Partial<OpacityFunction>) {
      // eslint-disable-next-line prefer-object-spread
      this.coloringConfig.opacityFunction = Object.assign(
        {},
        this.coloringConfig.opacityFunction,
        opacityFunc
      );
    },
    updateCVRParameters(params: Partial<CVRConfig>) {
      this.cvrConfig = {
        ...this.cvrConfig,
        ...params,
      };
    },
  },
});
