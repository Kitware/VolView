import macro from '@kitware/vtk.js/macro';

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkCrosshairsWidgetProp');

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);

  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e: any) => {
    if (!model.pickable) {
      return macro.VOID;
    }

    model.widgetState.setDragging(true);
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
      model.widgetState.getDragging() &&
      model.pickable &&
      model.manipulator
    ) {
      const { worldCoords } = model.manipulator.handleEvent(
        callData,
        model._apiSpecificRenderWindow
      );

      // The point is left unclamped here: only the view this widget belongs to
      // knows which image it should be confined to.
      model.widgetState.getHandle().setOrigin(worldCoords);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag / Create new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonRelease = () => {
    if (model.widgetState.getDragging() && model.pickable) {
      model._interactor.cancelAnimation(publicAPI);
      model._apiSpecificRenderWindow.setCursor('default');
      publicAPI.invokeEndInteractionEvent();
    }
    model.widgetState.setDragging(false);
  };

  // --------------------------------------------------------------------------
  // Focus API - modeHandle follow mouse when widget has focus
  // --------------------------------------------------------------------------

  publicAPI.grabFocus = () => {};

  // --------------------------------------------------------------------------

  publicAPI.loseFocus = () => {};
}
