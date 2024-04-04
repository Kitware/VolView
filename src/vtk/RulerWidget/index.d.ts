import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { InteractionState } from './behavior';
import { useRulerStore } from '@/src/store/tools/rulers';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import {
  IAnnotationToolWidgetInitialValues,
  vtkAnnotationToolWidget,
  vtkAnnotationWidgetPointState,
  vtkAnnotationWidgetState,
} from '@/src/vtk/ToolWidgetUtils/types';
import { AnnotationToolType } from '@/src/store/tools/types';

export { InteractionState } from './behavior';

export interface vtkRulerWidgetPointState
  extends vtkAnnotationWidgetPointState {}

export interface vtkRulerWidgetState extends vtkAnnotationWidgetState {
  setIsPlaced(isPlaced: boolean): boolean;
  getIsPlaced(): boolean;
  getFirstPoint(): vtkRulerWidgetPointState;
  getSecondPoint(): vtkRulerWidgetPointState;
}

export interface vtkRulerViewWidget extends vtkAnnotationToolWidget {
  setInteractionState(state: InteractionState): boolean;
  getInteractionState(): InteractionState;
  getWidgetState(): vtkRulerWidgetState;
}

export interface IRulerWidgetInitialValues
  extends IAnnotationToolWidgetInitialValues {
  isPlaced: boolean;
}

export interface vtkRulerWidget
  extends vtkAbstractWidgetFactory<vtkRulerViewWidget> {
  getLength(): number;
  getWidgetState(): vtkRulerWidgetState;
}

function newInstance(initialValues: IRulerWidgetInitialValues): vtkRulerWidget;

export declare const vtkRulerWidget: {
  newInstance: typeof newInstance;
};
export default vtkRulerWidget;
