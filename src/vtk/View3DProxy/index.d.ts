import { vtkViewProxy } from '@kitware/vtk.js/Proxy/Core/ViewProxy';

export interface ViewProxyCustomizations {
  removeAllRepresentations(): void;
}
export interface vtkCustomView3DProxy
  extends vtkViewProxy,
    ViewProxyCustomizations {}

export function commonViewCustomizations(publicAPI: any, model: any): void;
