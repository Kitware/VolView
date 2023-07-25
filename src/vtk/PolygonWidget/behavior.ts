import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import macro from '@kitware/vtk.js/macros';

const FINISHABLE_DISTANCE = 60;

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

  function updateActiveStateHandle(callData: any) {
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

  function isFinishable() {
    // Check distance to first point?
    const handles = model.widgetState.getHandles();
    if (handles.length >= 3) {
      const moveCoords = model._apiSpecificRenderWindow.worldToDisplay(
        ...model.widgetState.getMoveHandle().getOrigin(),
        model._renderer
      );
      const firstCoords = model._apiSpecificRenderWindow.worldToDisplay(
        ...handles[0].getOrigin(),
        model._renderer
      );
      if (moveCoords && firstCoords)
        return (
          distance2BetweenPoints(firstCoords, moveCoords) < FINISHABLE_DISTANCE
        );
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag / Add new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e: any) => {
    const activeWidget = model._widgetManager.getActiveWidget();
    if (
      !model.manipulator ||
      ignoreKey(e) ||
      // If hovering over another widget, don't consume event.
      (activeWidget && activeWidget !== publicAPI)
    ) {
      return macro.VOID;
    }

    const manipulator =
      model.activeState?.getManipulator?.() ?? model.manipulator;
    if (model.widgetState.getPlacing() && manipulator) {
      // Dropping first point?
      if (model.widgetState.getHandles().length === 0) {
        // For updateActiveStateHandle
        model.activeState = model.widgetState.getMoveHandle();
        model._widgetManager.grabFocus(publicAPI);
      }
      updateActiveStateHandle(e);

      if (model.widgetState.getFinshable()) {
        model.widgetState.setPlacing(false);
        publicAPI.loseFocus();
        publicAPI.invokePlacedEvent();
        // Don't add another point, just return
        return macro.EVENT_ABORT;
      }

      // Add handle
      const moveHandle = model.widgetState.getMoveHandle();
      const newHandle = model.widgetState.addHandle();
      newHandle.setOrigin(moveHandle.getOrigin());
      newHandle.setScale1(moveHandle.getScale1());

      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (model.activeState?.getActive() && model.pickable && model.dragable) {
      model._isDragging = true;
      model._apiSpecificRenderWindow.setCursor('grabbing');
      model._interactor.requestAnimation(publicAPI);

      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData: any) => {
    if (
      model.pickable &&
      model.dragable &&
      model.activeState &&
      !ignoreKey(callData)
    ) {
      if (updateActiveStateHandle(callData) === macro.EVENT_ABORT) {
        model.widgetState.setFinshable(isFinishable());
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

  const reset = () => {
    publicAPI.loseFocus();
    model.widgetState.clearHandles();
  };

  // --------------------------------------------------------------------------
  // Escape key: clear handles
  // --------------------------------------------------------------------------

  publicAPI.handleKeyDown = ({ key }: any) => {
    if (model.widgetState.getPlacing() && key === 'Escape') {
      reset();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  // Called when mouse moves off handle.
  publicAPI.deactivateAllHandles = () => {
    model.widgetState.deactivate();
    // Context menu pops only if hovering over a handle.
    // Stops right clicking anywhere brining up context menu.
    model.activeState = null;
  };

  const removeLastHandle = () => {
    const handles = model.widgetState.getHandles();
    if (handles.length > 0) {
      model.widgetState.removeHandle(handles.length - 1);
      if (handles.length === 0) {
        reset();
      }
    }
  };

  // --------------------------------------------------------------------------
  // Right press: Remove last handle / Pop context menu
  // --------------------------------------------------------------------------

  publicAPI.handleRightButtonPress = (eventData: any) => {
    if (ignoreKey(eventData) || !model.activeState) {
      return macro.VOID;
    }

    if (model.widgetState.getPlacing()) {
      removeLastHandle();
      return macro.EVENT_ABORT;
    }

    publicAPI.invokeRightClickEvent(eventData);
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Focus API: After first point dropped, make moveHandle follow mouse
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
