import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

export interface ViewProxyCustomizations {
  removeAllRepresentations(): void;
}
export interface vtkLPSView3DProxy
  extends vtkViewProxy,
    ViewProxyCustomizations {}

export function commonViewCustomizations(publicAPI: any, model: any): void;

// TODO extend, newInstance...
export declare const vtkLPSView3DProxy: {};
export default vtkLPSView3DProxy;
