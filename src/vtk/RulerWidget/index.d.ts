import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { RulerWidgetState } from './state';
import { useRulerStore } from '@/src/store/tools/rulers';

export interface vtkRulerViewWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onFinalizedEvent(cb: (eventData: any) => void): vtkSubscription;
  resetInteractionState(): void;
}

export interface IRulerWidgetInitialValues {
  id: string;
  store: ReturnType<typeof useRulerStore>;
}

export interface vtkRulerWidget extends vtkAbstractWidgetFactory {
  getLength(): number;
  getWidgetState(): RulerWidgetState;
}

function newInstance(initialValues: IRulerWidgetInitialValues): vtkRulerWidget;

export function shouldIgnoreEvent(ev: any): boolean;

export declare const vtkRulerWidget: {
  newInstance: typeof newInstance;
};
export default vtkRulerWidget;
