import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { RectangleWidgetState } from './state';
import { useRectangleStore } from '@/src/store/tools/rectangles';

export interface vtkRectangleViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onFinalizedEvent(cb: (eventData: any) => void): vtkSubscription;
  resetInteractionState(): void;
}

export interface IRectangleWidgetInitialValues {
  id: string;
  store: ReturnType<typeof useRectangleStore>;
}

export interface vtkRectangleWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): RectangleWidgetState;
}

function newInstance(
  initialValues: IRectangleWidgetInitialValues
): vtkRectangleWidget;

export function shouldIgnoreEvent(ev: any): boolean;

export declare const vtkRectangleWidget: {
  newInstance: typeof newInstance;
};
export default vtkRectangleWidget;
