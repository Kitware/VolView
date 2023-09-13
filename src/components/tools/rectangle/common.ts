import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import vtkRectangleWidget, {
  vtkRectangleWidgetState,
} from '@/src/vtk/RectangleWidget';
import { Vector3 } from '@kitware/vtk.js/types';
import { reactive } from 'vue';

export interface RectangleInitState {
  firstPoint: Vector3;
  secondPoint: Vector3;
}

export function useSyncedRectangleState(widgetFactory: vtkRectangleWidget) {
  const widgetState = widgetFactory.getWidgetState() as vtkRectangleWidgetState;
  const syncedState = reactive({
    firstPoint: {
      visible: false,
      origin: null as Maybe<Vector3>,
    },
    secondPoint: {
      visible: false,
      origin: null as Maybe<Vector3>,
    },
  });

  const syncState = () => {
    syncedState.firstPoint.visible = widgetState.getFirstPoint().getVisible();
    syncedState.firstPoint.origin = widgetState.getFirstPoint().getOrigin();
    syncedState.secondPoint.visible = widgetState.getSecondPoint().getVisible();
    syncedState.secondPoint.origin = widgetState.getSecondPoint().getOrigin();
  };

  onVTKEvent(widgetState, 'onModified', () => syncState());
  syncState();

  return syncedState;
}
