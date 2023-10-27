import { Maybe } from '@/src/types';
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

export const computeWorldCoords = (model: any) => (event: any) => {
  const manipulator =
    model.activeState?.getManipulator?.() ?? model.manipulator;
  if (!manipulator) {
    console.error('No manipulator');
    return undefined;
  }
  const { worldCoords } = manipulator.handleEvent(
    event,
    model._apiSpecificRenderWindow
  );
  if (!worldCoords)
    console.warn('Event cannot be converted to world coordinates');
  return worldCoords;
};
