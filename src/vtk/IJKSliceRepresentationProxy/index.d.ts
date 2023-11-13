import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/SliceRepresentationProxy';

export interface vtkIJKSliceRepresentationProxy
  extends vtkSliceRepresentationProxy {
  setOpacity(opacity: number): boolean;
  getOpacity(): number;
}

export function extend(publicAPI: any, model: any): void;

export declare const vtkIJKSliceRepresentationProxy: {
  extend: typeof extend;
};

export default vtkIJKSliceRepresentationProxy;
