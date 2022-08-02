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
}

export interface OpacityPoints {
  mode: IPiecewiseFunctionProxyMode.Points;
  // name of preset that has the points
  name: string;
  shift: number;
}

export interface OpacityNodes {
  mode: IPiecewiseFunctionProxyMode.Nodes;
  nodes: PiecewiseNode[];
}

export type OpacityFunction = OpacityGaussians | OpacityPoints | OpacityNodes;
export interface ColoringConfig {
  colorBy: ColorBy;
  transferFunction: string;
  opacityFunction: OpacityFunction;
}

interface State {
  coloringConfig: ColoringConfig;
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
): OpacityFunction {
  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    return {
      mode: vtkPiecewiseFunctionProxy.Mode.Points,
      name: presetName,
      shift: 0,
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
      transferFunction: DEFAULT_PRESET,
      opacityFunction: {
        mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
        gaussians: [],
      },
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
    setColorTransferFunction(name: string) {
      this.coloringConfig.transferFunction = name;
    },
    resetToDefaultColoring(image: vtkImageData) {
      this.setDefaultColorByFromImage(image);
      this.setColorTransferFunction(DEFAULT_PRESET);
      this.setOpacityFunction(getOpacityFunctionFromPreset(DEFAULT_PRESET));
    },
    setOpacityFunction(opacityFunc: OpacityFunction) {
      this.coloringConfig.opacityFunction = opacityFunc;
    },
  },
});
