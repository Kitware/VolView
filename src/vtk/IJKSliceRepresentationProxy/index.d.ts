import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/SliceRepresentationProxy';

export interface vtkIJKSliceRepresentationProxy
  extends vtkSliceRepresentationProxy {
  setOpacity(opacity: number): boolean;
  getOpacity(): number;
}

export default vtkIJKSliceRepresentationProxy;
