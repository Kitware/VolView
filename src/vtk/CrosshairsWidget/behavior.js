import macro from 'vtk.js/Sources/macro';

function clampPointToBounds(bounds, point) {
  return point.map((p, i) =>
    Math.max(bounds[i * 2], Math.min(bounds[i * 2 + 1], p))
  );
}

export default function widgetBehavior(publicAPI, model) {
  model.classHierarchy.push('vtkCrosshairsWidgetProp');
  let isDragging = false;

  // --------------------------------------------------------------------------
  // Display 2D
  // --------------------------------------------------------------------------

  // publicAPI.setDisplayCallback = (callback) =>
  //   model.representations[0].setDisplayCallback(callback);

  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  function ignoreKey(e) {
    return e.altKey || e.controlKey || e.shiftKey;
  }

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e) => {
    if (!model.pickable || ignoreKey(e)) {
      return macro.VOID;
    }

    model.widgetState.setPlaced(true);
    isDragging = true;
    model.interactor.requestAnimation(publicAPI);
    model.openGLRenderWindow.setCursor('crosshairs');
    publicAPI.invokeStartInteractionEvent();
    publicAPI.handleMouseMove(e);
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData) => {
    if (
      (!model.widgetState.getPlaced() || isDragging) &&
      model.pickable &&
      model.manipulator &&
      !ignoreKey(callData)
    ) {
      const worldCoords = model.manipulator.handleEvent(
        callData,
        model.openGLRenderWindow
      );

      const handle = model.widgetState.getHandle();
      const bounds = handle.getBounds();
      handle.setOrigin(clampPointToBounds(bounds, worldCoords));

      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag / Create new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonRelease = () => {
    if (isDragging && model.pickable) {
      model.interactor.cancelAnimation(publicAPI);
      model.openGLRenderWindow.setCursor('default');
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
