import macro from '@kitware/vtk.js/macro';
import type { Bounds } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';

function clampPointToBounds(bounds: Bounds, point: vec3) {
  return point.map((p, i) =>
    Math.max(bounds[i * 2], Math.min(bounds[i * 2 + 1], p))
  ) as vec3;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkCrosshairsWidgetProp');
  let isDragging = false;

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);

  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  function ignoreKey(e: any) {
    return e.altKey || e.controlKey || e.shiftKey;
  }

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e: any) => {
    if (!model.pickable || ignoreKey(e)) {
      return macro.VOID;
    }

    model.widgetState.setPlaced(true);
    isDragging = true;
    model._interactor.requestAnimation(publicAPI);
    model._apiSpecificRenderWindow.setCursor('crosshairs');
    publicAPI.invokeStartInteractionEvent();
    publicAPI.handleMouseMove(e);
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData: any) => {
    // technically need to call requestAnimation during
    // the initial phase of placing the crosshairs,
    // but that's not needed since no VTK object
    // is actually being rendered.

    if (
      (!model.widgetState.getPlaced() || isDragging) &&
      model.pickable &&
      model.manipulator &&
      !ignoreKey(callData)
    ) {
      const { worldCoords: worldCoordsOfPointer } =
        model.manipulator.handleEvent(callData, model._apiSpecificRenderWindow);

      const handle = model.widgetState.getHandle();
      const worldToIndex = model.widgetState.getWorldToIndex();
      const indexToWorld = model.widgetState.getIndexToWorld();
      if (worldToIndex.length && indexToWorld.length) {
        const indexCoordsOfPointer = vec3.create();
        const worldOrigin = vec3.create();
        const bounds = handle.getBounds();

        vec3.transformMat4(
          indexCoordsOfPointer,
          worldCoordsOfPointer,
          worldToIndex
        );
        const indexOrigin = clampPointToBounds(bounds, indexCoordsOfPointer);
        vec3.transformMat4(worldOrigin, indexOrigin, indexToWorld);

        handle.setOrigin(worldOrigin);
        publicAPI.invokeInteractionEvent();
        return macro.EVENT_ABORT;
      }
    }

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag / Create new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonRelease = () => {
    if (isDragging && model.pickable) {
      model._interactor.cancelAnimation(publicAPI);
      model._apiSpecificRenderWindow.setCursor('default');
      publicAPI.invokeEndInteractionEvent();
    }
    isDragging = false;
  };

  // --------------------------------------------------------------------------
  // Focus API - modeHandle follow mouse when widget has focus
  // --------------------------------------------------------------------------

  publicAPI.grabFocus = () => {};

  // --------------------------------------------------------------------------

  publicAPI.loseFocus = () => {};
}
