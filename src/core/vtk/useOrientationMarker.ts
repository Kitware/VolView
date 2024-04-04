import { Maybe } from '@/src/types';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import { Corners } from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget/Constants';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import { MaybeRef, computed, onScopeDispose, unref, watchEffect } from 'vue';

export const DEFAULT_CORNER = Corners.BOTTOM_LEFT;
export const DEFAULT_VIEWPORT_SIZE = 0.1;

export interface UseOrientationMarkerOptions {
  corner?: Corners;
  size?: number;
}

export function useOrientationMarker(
  actor: MaybeRef<Maybe<vtkActor>>,
  interactor: vtkRenderWindowInteractor,
  options?: MaybeRef<Maybe<UseOrientationMarkerOptions>>
) {
  const widget = vtkOrientationMarkerWidget.newInstance({
    interactor,
  });

  watchEffect(() => {
    const actorVal = unref(actor);
    if (actorVal) {
      widget.setActor(actorVal);
      widget.setEnabled(true);
    } else {
      widget.setEnabled(false);
    }
  });

  onScopeDispose(() => {
    widget.setEnabled(false);
  });

  const corner = computed(() => unref(options)?.corner ?? DEFAULT_CORNER);
  watchEffect(() => {
    widget.setViewportCorner(corner.value);
  });

  const viewportSize = computed(
    () => unref(options)?.size ?? DEFAULT_VIEWPORT_SIZE
  );
  watchEffect(() => {
    widget.setViewportSize(viewportSize.value);
  });

  return { widget };
}
