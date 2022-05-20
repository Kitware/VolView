import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { mat4 } from 'gl-matrix';
import { PaintWidgetState } from './state';

export interface vtkPaintViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  setSlicingIndex(index: number): boolean;
  setIndexToWorld(transform: mat4): boolean;
  getIndexToWorld(): mat4;
  setWorldToIndex(transform: mat4): boolean;
  getWorldToIndex(): mat4;
}

export interface vtkPaintWidget extends vtkAbstractWidgetFactory {
  getWidgetState(): PaintWidgetState;
}

export function newInstance(): vtkPaintWidget;

export function shouldIgnoreEvent(ev: any): boolean;

export declare const vtkPaintWidget: {
  newInstance: typeof newInstance;
};
export default vtkPaintWidget;
