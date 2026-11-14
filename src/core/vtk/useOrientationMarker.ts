import { View } from '@/src/core/vtk/types';
import { Maybe } from '@/src/types';
import macro from '@kitware/vtk.js/macros';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import { Corners } from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget/Constants';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { MaybeRef, computed, onScopeDispose, unref, watchEffect } from 'vue';

export const DEFAULT_CORNER = Corners.BOTTOM_LEFT;
export const DEFAULT_VIEWPORT_SIZE = 0.1;

export interface UseOrientationMarkerOptions {
  corner?: Corners;
  size?: number;
}

// vtk freezes instances, so the override has to happen in extend.
function extendMarker(publicAPI: any, model: any, initialValues = {}) {
  vtkOrientationMarkerWidget.extend(publicAPI, model, initialValues);
  publicAPI.fitViewport = () => {
    const viewport = model.enabled && publicAPI.computeViewport();
    return !!viewport && publicAPI.getRenderer().setViewport(...viewport);
  };
  // The stock widget renders the whole view on every canvas resize, though the
  // view renders after resizing anyway.
  publicAPI.updateViewport = () => {
    if (publicAPI.fitViewport()) model._interactor.render();
  };
}

const newMarker = macro.newInstance(
  extendMarker,
  'vtkFittedOrientationMarker'
) as (
  initialValues: object
) => vtkOrientationMarkerWidget & { fitViewport(): boolean };

export function useOrientationMarker(
  actor: MaybeRef<Maybe<vtkActor>>,
  {
    interactor,
    renderWindowView,
  }: Pick<View, 'interactor' | 'renderWindowView'>,
  options?: MaybeRef<Maybe<UseOrientationMarkerOptions>>
) {
  const widget = newMarker({ interactor });
  // fit the marker before the view renders at its new size
  const resizeSub = renderWindowView.onWindowResizeEvent(widget.fitViewport);
  onScopeDispose(() => resizeSub.unsubscribe());

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
    widget.delete();
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
