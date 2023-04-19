import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { InteractionState } from './behavior';
import { useRulerStore } from '@/src/store/tools/rulers';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';

export { InteractionState } from './behavior';

export interface vtkRulerWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
}

export interface vtkRulerWidgetState extends vtkWidgetState {
  setIsPlaced(isPlaced: boolean): boolean;
  getIsPlaced(): boolean;
  getFirstPoint(): vtkRulerWidgetPointState;
  getSecondPoint(): vtkRulerWidgetPointState;
}

export interface vtkRulerViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onPlacedEvent(cb: (eventData: any) => void): vtkSubscription;
  setInteractionState(state: InteractionState): boolean;
  getInteractionState(): InteractionState;
  resetInteractions(): void;
  getWidgetState(): vtkRulerWidgetState;
}

export interface IRulerWidgetInitialValues {
  id: string;
  store: ReturnType<typeof useRulerStore>;
  isPlaced: boolean;
}

export interface vtkRulerWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): vtkRulerWidgetState;
}

function newInstance(initialValues: IRulerWidgetInitialValues): vtkRulerWidget;

export declare const vtkRulerWidget: {
  newInstance: typeof newInstance;
};
export default vtkRulerWidget;
