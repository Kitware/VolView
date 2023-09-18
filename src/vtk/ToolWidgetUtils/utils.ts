import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';

export function watchState(
  publicAPI: any,
  state: any,
  callback: () => unknown
) {
  let subscription = state.onModified(callback);
  const originalDelete = publicAPI.delete;
  publicAPI.delete = () => {
    subscription.unsubscribe();
    subscription = null;
    originalDelete();
  };
}

export type WidgetAction = {
  name: string;
  func: () => void;
};

export interface vtkAnnotationToolWidget extends vtkAbstractWidget {
  setManipulator(manipulator: vtkPlaneManipulator): boolean;
  getManipulator(): vtkPlaneManipulator;
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onPlacedEvent(cb: (eventData: any) => void): vtkSubscription;
  onHoverEvent(cb: (eventData: any) => void): vtkSubscription;
  resetInteractions(): void;
}
