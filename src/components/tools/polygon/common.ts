import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import vtkPolygonWidget, {
  vtkPolygonWidgetState,
} from '@/src/vtk/PolygonWidget';
import { Vector3 } from '@kitware/vtk.js/types';
import { shallowReactive } from 'vue';

export interface PolygonInitState {
  points: Vector3[];
}

export function useSyncedPolygonState(widgetFactory: vtkPolygonWidget) {
  const syncedState = shallowReactive({
    points: [] as Vector3[],
    movePoint: null as Maybe<Vector3>,
    finishable: false,
  });

  const widgetState = widgetFactory.getWidgetState() as vtkPolygonWidgetState;
  const syncState = () => {
    syncedState.points = widgetState
      .getHandleList()
      .map((handle) => handle.getOrigin())
      .filter((pt): pt is Vector3 => !!pt);
    syncedState.movePoint = widgetState.getMoveHandle().getOrigin();
    syncedState.finishable = widgetState.getFinishable();
  };

  onVTKEvent(widgetState, 'onModified', () => syncState());
  syncState();

  return syncedState;
}
