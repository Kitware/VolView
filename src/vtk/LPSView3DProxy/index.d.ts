import { vec3 } from 'gl-matrix';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';

export interface vtkLPSView3DProxy extends vtkViewProxy {
  removeAllRepresentations(): void;
  updateCamera(directionOfProjection: vec3, viewUp: vec3, focalPoint: vec3);
  getInteractorStyle2D(): vtkInteractorStyleManipulator;
  getInteractorStyle3D(): vtkInteractorStyleManipulator;
}

export function commonViewCustomizations(publicAPI: any, model: any): void;

// TODO extend, newInstance...
export declare const vtkLPSView3DProxy: {};
export default vtkLPSView3DProxy;
