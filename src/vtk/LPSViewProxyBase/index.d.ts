import { vec3 } from 'gl-matrix';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';

export interface LPSViewProxyBase {
  removeAllRepresentations(): void;
  updateCamera(directionOfProjection: vec3, viewUp: vec3, focalPoint: vec3);
  getInteractorStyle2D(): vtkInteractorStyleManipulator;
  getInteractorStyle3D(): vtkInteractorStyleManipulator;
  getWidgetManager(): vtkWidgetManager;
}

export function applyLPSViewProxyBase(publicAPI: object, model: object);
