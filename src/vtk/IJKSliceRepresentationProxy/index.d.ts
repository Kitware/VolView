import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Core/SliceRepresentationProxy';

export interface vtkIJKSliceRepresentationProxy
  extends vtkSliceRepresentationProxy {
  setOpacity(opacity: number): boolean;
  getOpacity(): number;
}

export default vtkIJKSliceRepresentationProxy;
