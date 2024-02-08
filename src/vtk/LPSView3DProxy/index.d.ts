import { vec3 } from 'gl-matrix';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { LPSViewProxyBase } from '@/src/vtk/LPSViewProxyBase';

export interface vtkLPSView3DProxy extends LPSViewProxyBase, vtkViewProxy {}

export function extend(publicAPI: object, model: object): void;

export declare const vtkLPSView3DProxy: {
  extend: typeof extend;
};

export default vtkLPSView3DProxy;
