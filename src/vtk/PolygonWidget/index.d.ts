import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { InteractionState } from './behavior';
import { usePolygonStore } from '@/src/store/tools/polygons';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';

export { InteractionState } from './behavior';

export interface vtkPolygonWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
}

export interface vtkPolygonWidgetState extends vtkWidgetState {
  getMoveHandle(): any;
  clearHandles(): void;
  getPlacing(): boolean;
  setPlacing(is: boolean): void;
  getFinishable(): boolean;
  setFinishable(is: boolean): void;
}

export interface vtkPolygonViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onPlacedEvent(cb: (eventData: any) => void): vtkSubscription;
  setInteractionState(state: InteractionState): boolean;
  getInteractionState(): InteractionState;
  resetInteractions(): void;
  getWidgetState(): vtkPolygonWidgetState;
}

export interface IPolygonWidgetInitialValues {
  id: string;
  store: ReturnType<typeof usePolygonStore>;
}

export interface vtkPolygonWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): vtkPolygonWidgetState;
}

function newInstance(
  initialValues: IPolygonWidgetInitialValues
): vtkPolygonWidget;

export declare const vtkPolygonWidget: {
  newInstance: typeof newInstance;
};
export default vtkPolygonWidget;
