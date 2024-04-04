import { VTKEventHandler } from '@/src/composables/onVTKEvent';
import { AnnotationToolType } from '@/src/store/tools/types';
import { ToolID } from '@/src/types/annotation-tool';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import type { Vector2, Vector3 } from '@kitware/vtk.js/types';

export type WidgetAction = {
  name: string;
  func: () => void;
};

export type ContextMenuEvent = {
  displayXY: Vector2;
  widgetActions: Array<WidgetAction>;
};

export interface vtkAnnotationWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
  getOrigin(): Vector3 | null;
}

export interface vtkAnnotationWidgetState extends vtkWidgetState {
  getId(): ToolID;
  getToolType(): AnnotationToolType;
}

export interface IAnnotationToolWidgetInitialValues {
  id: ToolID;
}

export interface vtkAnnotationToolWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: VTKEventHandler): vtkSubscription;
  onPlacedEvent(cb: VTKEventHandler): vtkSubscription;
  onHoverEvent(cb: VTKEventHandler): vtkSubscription;
  resetInteractions(): void;
  getWidgetState(): vtkAnnotationWidgetState;
}
