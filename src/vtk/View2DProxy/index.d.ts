import { vtkView2DProxy } from '@kitware/vtk.js/Proxy/Core/View2DProxy';
import { ViewProxyCustomizations } from '@src/vtk/View3DProxy';

export interface vtkCustomView2DProxy
  extends vtkView2DProxy,
    ViewProxyCustomizations {}
