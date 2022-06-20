import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { mat4, vec3 } from 'gl-matrix';
import { CrosshairsWidgetState } from './state';

export interface vtkCrosshairsViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
}

export interface vtkCrosshairsWidget extends vtkAbstractWidgetFactory {
  getWidgetState(): CrosshairsWidgetState;
  getManipulator(): vtkPlaneManipulator;
}

export function newInstance(): vtkCrosshairsWidget;

export declare const vtkCrosshairsWidget: {
  newInstance: typeof newInstance;
};
export default vtkCrosshairsWidget;
