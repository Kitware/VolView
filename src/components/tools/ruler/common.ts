import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import vtkRulerWidget, { vtkRulerWidgetState } from '@/src/vtk/RulerWidget';
import { Vector3 } from '@kitware/vtk.js/types';
import { reactive } from 'vue';

export interface RulerInitState {
  firstPoint: Vector3;
  secondPoint: Vector3;
}

export function useSyncedRulerState(widgetFactory: vtkRulerWidget) {
  const widgetState = widgetFactory.getWidgetState() as vtkRulerWidgetState;
  const syncedState = reactive({
    firstPoint: {
      visible: false,
      origin: null as Maybe<Vector3>,
    },
    secondPoint: {
      visible: false,
      origin: null as Maybe<Vector3>,
    },
    length: 0,
  });

  const syncState = () => {
    syncedState.firstPoint.visible = widgetState.getFirstPoint().getVisible();
    syncedState.firstPoint.origin = widgetState.getFirstPoint().getOrigin();
    syncedState.secondPoint.visible = widgetState.getSecondPoint().getVisible();
    syncedState.secondPoint.origin = widgetState.getSecondPoint().getOrigin();
    syncedState.length = widgetFactory.getLength();
  };

  onVTKEvent(widgetState, 'onModified', () => syncState());
  syncState();

  return syncedState;
}
