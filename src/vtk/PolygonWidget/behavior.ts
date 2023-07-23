import macro from '@kitware/vtk.js/macros';

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkPolygonWidgetProp');
  model._isDragging = false;

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);
  // support forwarding events
  macro.event(publicAPI, model, 'RightClickEvent');
  macro.event(publicAPI, model, 'PlacedEvent');

  publicAPI.resetInteractions = () => {
    model._interactor.cancelAnimation(publicAPI, true);
  };

  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  function ignoreKey(e: any) {
    return e.altKey || e.controlKey || e.shiftKey;
  }

  function updateMoveHandle(callData: any) {
    const manipulator =
      model.activeState?.getManipulator?.() ?? model.manipulator;
    if (!manipulator) {
      return macro.VOID;
    }

    const worldCoords = manipulator.handleEvent(
      callData,
      model._apiSpecificRenderWindow
    );

    if (
      worldCoords.length &&
      (model.activeState === model.widgetState.getMoveHandle() ||
        model._isDragging) &&
      model.activeState.setOrigin // e.g. the line is pickable but not draggable
    ) {
      model.activeState.setOrigin(worldCoords);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }
    return macro.VOID;
  }

  // delete handle
  // publicAPI.handleRightButtonPress = (e) => {
  //   if (
  //     !model.activeState ||
  //     !model.activeState.getActive() ||
  //     !model.pickable ||
  //     ignoreKey(e)
  //   ) {
  //     return macro.VOID;
  //   }

  //   if (model.activeState !== model.widgetState.getMoveHandle()) {
  //     model._interactor.requestAnimation(publicAPI);
  //     model.activeState.deactivate();
  //     model.widgetState.removeHandle(model.activeState);
  //     model.activeState = null;
  //     model._interactor.cancelAnimation(publicAPI);
  //   }

  //   publicAPI.invokeStartInteractionEvent();
  //   publicAPI.invokeInteractionEvent();
  //   publicAPI.invokeEndInteractionEvent();
  //   return macro.EVENT_ABORT;
  // };

  publicAPI.handleRightButtonPress = (eventData: any) => {
    if (
      ignoreKey(eventData) ||
      // publicAPI.getInteractionState() !== InteractionState.Select ||
      !model.activeState
    ) {
      return macro.VOID;
    }
    publicAPI.invokeRightClickEvent(eventData);
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag / Create new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e: any) => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable ||
      ignoreKey(e)
    ) {
      return macro.VOID;
    }
    const manipulator =
      model.activeState?.getManipulator?.() ?? model.manipulator;
    if (
      model.activeState === model.widgetState.getMoveHandle() &&
      manipulator
    ) {
      updateMoveHandle(e);
      const moveHandle = model.widgetState.getMoveHandle();
      const newHandle = model.widgetState.addHandle();
      newHandle.setOrigin(moveHandle.getOrigin());
      newHandle.setScale1(moveHandle.getScale1());
      // newHandle.setManipulator(manipulator);
    } else if (model.dragable) {
      model._isDragging = true;
      model._apiSpecificRenderWindow.setCursor('grabbing');
      model._interactor.requestAnimation(publicAPI);
    }

    publicAPI.invokeStartInteractionEvent();
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData: any) => {
    if (
      model.pickable &&
      model.dragable &&
      model.activeState &&
      model.activeState.getActive() &&
      !ignoreKey(callData)
    ) {
      if (updateMoveHandle(callData) === macro.EVENT_ABORT) {
        return macro.EVENT_ABORT;
      }
    }
    if (model.hasFocus) {
      model._widgetManager.disablePicking();
    }
    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonRelease = () => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable
    ) {
      return macro.VOID;
    }

    if (model._isDragging) {
      model._apiSpecificRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model._interactor.cancelAnimation(publicAPI);
      model._isDragging = false;
    } else if (model.activeState !== model.widgetState.getMoveHandle()) {
      model.widgetState.deactivate();
    }

    if (
      (model.hasFocus && !model.activeState) ||
      (model.activeState && !model.activeState.getActive())
    ) {
      model._widgetManager.enablePicking();
      model._interactor.render();
    }

    publicAPI.invokeEndInteractionEvent();
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Escape key: clear handles
  // --------------------------------------------------------------------------

  publicAPI.handleKeyDown = ({ key }: any) => {
    if (key === 'Escape') {
      model.widgetState.clearHandles();
    }
  };

  // --------------------------------------------------------------------------
  // Focus API - modeHandle follow mouse when widget has focus
  // --------------------------------------------------------------------------

  publicAPI.grabFocus = () => {
    if (!model.hasFocus) {
      model.activeState = model.widgetState.getMoveHandle();
      model.activeState.activate();
      model.activeState.setVisible(true);
      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
    }
    model.hasFocus = true;
  };

  // --------------------------------------------------------------------------

  publicAPI.loseFocus = () => {
    if (model.hasFocus) {
      model._interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
    }
    model.widgetState.deactivate();
    model.widgetState.getMoveHandle().deactivate();
    model.widgetState.getMoveHandle().setVisible(false);
    model.widgetState.getMoveHandle().setOrigin(null);
    model.activeState = null;
    model.hasFocus = false;
    model._widgetManager.enablePicking();
    model._interactor.render();
  };
}
