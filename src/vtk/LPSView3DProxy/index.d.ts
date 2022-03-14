import { vec3 } from 'gl-matrix';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

export interface ViewProxyCustomizations {
  removeAllRepresentations(): void;
  updateCamera(directionOfProjection: vec3, viewUp: vec3, focalPoint: vec3);
}
export interface vtkLPSView3DProxy
  extends vtkViewProxy,
    ViewProxyCustomizations {}

export function commonViewCustomizations(publicAPI: any, model: any): void;

// TODO extend, newInstance...
export declare const vtkLPSView3DProxy: {};
export default vtkLPSView3DProxy;
