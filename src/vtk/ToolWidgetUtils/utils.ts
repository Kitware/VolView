import { Maybe } from '@/src/types';
import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
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
  onRightClickEvent(cb: (eventData: any) => void): vtkSubscription;
  onPlacedEvent(cb: (eventData: any) => void): vtkSubscription;
  resetInteractions(): void;
}
