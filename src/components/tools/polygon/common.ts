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

export interface PolygonSyncedState {
  points: Vector3[];
  movePoint: Maybe<Vector3>;
  finishable: boolean;
}

export function useSyncedPolygonState(
  widgetFactory: vtkPolygonWidget
): PolygonSyncedState {
  const syncedState = shallowReactive<PolygonSyncedState>({
    points: [],
    movePoint: null,
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
