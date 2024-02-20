import { vtkObject } from '@kitware/vtk.js/interfaces';
import { MaybeRef } from 'vue';
import {
  OnVTKEventOptions,
  VTKEventHandler,
  VTKEventListener,
  onVTKEvent,
} from './onVTKEvent';

export function onPausableVTKEvent<T extends vtkObject, K extends keyof T>(
  vtkObj: MaybeRef<T | undefined | null>,
  eventHookName: T[K] extends VTKEventListener ? K : never,
  callback: VTKEventHandler,
  options?: OnVTKEventOptions
) {
  let paused = false;

  const pause = () => {
    paused = true;
  };

  const resume = () => {
    paused = false;
  };

  const withPaused = (fn: () => void) => {
    pause();
    try {
      fn();
    } finally {
      resume();
    }
  };

  const { stop } = onVTKEvent(
    vtkObj,
    eventHookName,
    (obj) => {
      if (!paused) callback(obj);
    },
    options
  );

  return {
    stop,
    pause,
    resume,
    withPaused,
  };
}
