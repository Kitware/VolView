import {
  IPiecewiseFunctionProxyMode,
  PiecewiseGaussian,
  PiecewiseNode,
} from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

export interface ViewSpec {
  viewType: string;
  props: Record<string, any>;
}

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
  shiftAlpha: number;
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

  lightFollowsCamera: boolean;
  volumeQuality: number;

  useVolumetricScatteringBlending: boolean;
  volumetricScatteringBlending: number;

  useLocalAmbientOcclusion: boolean;
  laoKernelSize: number;
  laoKernelRadius: number;
  ambient: number;
  diffuse: number;
  specular: number;
}

export interface BlendConfig {
  opacity: number;
}
