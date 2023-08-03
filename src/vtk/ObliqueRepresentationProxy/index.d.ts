import { vec3 } from 'gl-matrix';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';

export interface vtkObliqueRepresentationProxy
  extends vtkResliceRepresentationProxy {
  setOutlineColor(color: vec3): boolean;
  getOutlineColor(): vec3;
  setOutlineVisibility(visibility: boolean): boolean;
  getOutlineVisibility(): boolean;
}

export default vtkObliqueRepresentationProxy;
