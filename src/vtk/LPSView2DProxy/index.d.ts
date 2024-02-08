import { vec3 } from 'gl-matrix';
import { vtkView2DProxy } from '@kitware/vtk.js/Proxy/Core/View2DProxy';
import { ViewProxyCustomizations } from '@/src/vtk/LPSView3DProxy';
import { LPSViewProxyBase } from '@/src/vtk/LPSViewProxyBase';

// LPSViewProxyBase changes some types from vtkView2DProxy
export interface vtkLPSView2DProxy extends LPSViewProxyBase, vtkView2DProxy {
  resizeToFit(lookAxis: Vector3, viewUpAxis: Vector3, worldDims: Vector3);
  resetCamera(boundsToUse?: number[]);
  /**
   * @param mode One of IJKXYZ
   */
  setSlicingMode(mode: string);
}

export function extend(publicAPI: object, model: object): void;

export declare const vtkLPSView2DProxy: {
  extend: typeof extend;
};

export default vtkLPSView2DProxy;
