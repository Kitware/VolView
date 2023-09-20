import { VTKEventHandler } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { Vector3 } from '@kitware/vtk.js/types';
import { Store } from 'pinia';

export function watchStore<T>(
  publicAPI: any,
  store: Store,
  getter: () => Maybe<T>,
  cmp: (a: Maybe<T>, b: Maybe<T>) => boolean
) {
  let cached = getter();
  const unsubscribe = store.$subscribe(() => {
    const val = getter();
    if (cmp ? cmp(cached, val) : cached !== val) {
      cached = val;
      publicAPI.modified();
    }
  });

  const originalDelete = publicAPI.delete;
  publicAPI.delete = () => {
    unsubscribe();
    originalDelete();
  };
}

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
  onRightClickEvent(cb: VTKEventHandler): vtkSubscription;
  onPlacedEvent(cb: VTKEventHandler): vtkSubscription;
  onHoverEvent(cb: VTKEventHandler): vtkSubscription;
  onSelectEvent(cb: VTKEventHandler): vtkSubscription;
  resetInteractions(): void;
}

export interface vtkAnnotationWidgetPointState extends vtkWidgetState {
  getVisible(): boolean;
  getOrigin(): Vector3 | null;
}
