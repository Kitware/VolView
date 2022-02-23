import { vec3 } from 'gl-matrix';
import { vtkView2DProxy } from '@kitware/vtk.js/Proxy/Core/View2DProxy';
import { ViewProxyCustomizations } from '@src/vtk/LPSView3DProxy';

export interface vtkLPSView2DProxy
  extends vtkView2DProxy,
    ViewProxyCustomizations {
  updateCamera(directionOfProjection: vec3, viewUp: vec3, focalPoint: vec3);
  resizeToFit(lookAxis: Vector3, viewUpAxis: Vector3, worldDims: Vector3);
  /**
   * @param mode One of IJKXYZ
   */
  setSlicingMode(mode: string);
}
