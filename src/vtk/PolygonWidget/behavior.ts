import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import macro from '@kitware/vtk.js/macros';
import { Vector3 } from '@kitware/vtk.js/types';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';

import { WidgetAction } from '../ToolWidgetUtils/utils';

type Position3d = { x: number; y: number; z: number };
type vtkMouseEvent = {
  position: Position3d;
  pokedRenderer: vtkRenderer;
};

const FINISHABLE_DISTANCE = 10;
const FINISHABLE_DISTANCE_SQUARED = FINISHABLE_DISTANCE ** 2;

const DOUBLE_CLICK_TIMEOUT = 300; // milliseconds
const DOUBLE_CLICK_SLIP_DISTANCE_MAX = 10; // pixels
const DOUBLE_CLICK_SLIP_DISTANCE_MAX_SQUARED =
  DOUBLE_CLICK_SLIP_DISTANCE_MAX ** 2;

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkPolygonWidgetBehavior');
  model._isDragging = false;

  // overUnselectedHandle is true if mouse is over handle that was created before a mouse move event.
  // If creating new handle and immediately dragging,
  // widgetManager.getSelections() still points to the last actor
  // after the mouse button is released. In this widgets case the last actor is part of the LineGlyphRepresentation.
  // So overUnselectedHandle tracks if the mouse is over the new handle so we
  // don't create a another handle when clicking after without mouse move.
  // A mouse move event sets overUnselectedHandle to false as we can then rely on widgetManager.getSelections().
  let overUnselectedHandle = false;

  // Check if mouse is over line segment between handles
  const checkOverSegment = () => {
    // overSegment guards against clicking anywhere in view
    const selections = model._widgetManager.getSelections();
    const overSegment =
      selections[0]?.getProperties().prop ===
      model.representations[1].getActors()[0]; // line representation is second representation
    return overSegment && !overUnselectedHandle;
  };

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);

  // events to emit
  macro.event(publicAPI, model, 'RightClickEvent');
  macro.event(publicAPI, model, 'PlacedEvent');
  macro.event(publicAPI, model, 'HoverEvent');

  publicAPI.resetInteractions = () => {
    model._interactor.cancelAnimation(publicAPI, true);
  };

  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  function ignoreKey(e: any) {
    return e.altKey || e.controlKey || e.shiftKey;
  }

  const reset = () => {
    publicAPI.loseFocus();
    model.widgetState.clearHandles();
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

  const finishPlacing = () => {
    model.widgetState.setPlacing(false);
    publicAPI.loseFocus();
    // Tool Component listens for 'placed' event
    publicAPI.invokePlacedEvent();
  };

  function isFinishable() {
    const handles = model.widgetState.getHandles();
    const moveHandle = model.widgetState.getMoveHandle();

    if (model.activeState === moveHandle && handles.length >= 3) {
      // Check moveHandle distance to first handle
      const moveCoords = model._apiSpecificRenderWindow.worldToDisplay(
        ...moveHandle.getOrigin(),
        model._renderer
      );
      const firstCoords = model._apiSpecificRenderWindow.worldToDisplay(
        ...handles[0].getOrigin(),
        model._renderer
      );
      if (!moveCoords || !firstCoords) return false;

      const cssPixelDistance =
        FINISHABLE_DISTANCE_SQUARED *
        model._apiSpecificRenderWindow.getComputedDevicePixelRatio();
      const distance = distance2BetweenPoints(firstCoords, moveCoords);
      return distance < cssPixelDistance;
    }

    return false;
  }

  function getWorldCoords(callData: any) {
    const manipulator =
      model.activeState?.getManipulator?.() ?? model.manipulator;
    if (!manipulator) {
      return undefined;
    }

    return manipulator.handleEvent(callData, model._apiSpecificRenderWindow);
  }

  function updateActiveStateHandle(callData: any) {
    const worldCoords = getWorldCoords(callData);

    if (
      worldCoords?.length &&
      (model.activeState === model.widgetState.getMoveHandle() ||
        model._isDragging)
    ) {
      model.activeState.setOrigin(worldCoords);

      model.widgetState.setFinishable(isFinishable());

      if (model.widgetState.getFinishable())
        // snap to first point
        model.activeState.setOrigin(
          model.widgetState.getHandles()[0].getOrigin()
        );

      publicAPI.invokeInteractionEvent();

      return macro.EVENT_ABORT;
    }
    return macro.VOID;
  }

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag / Add new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (event: vtkMouseEvent) => {
    const activeWidget = model._widgetManager.getActiveWidget();

    // turns off hover while dragging
    publicAPI.invokeHoverEvent({
      ...event,
      hovering: false,
    });

    if (
      !model.manipulator ||
      ignoreKey(event) ||
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
      updateActiveStateHandle(event);

      if (model.widgetState.getFinishable()) {
        finishPlacing();
        // Don't add another point, just return
        return macro.EVENT_ABORT;
      }

      // Add handle
      const moveHandle = model.widgetState.getMoveHandle();
      const newHandle = model.widgetState.addHandle();
      newHandle.setOrigin(moveHandle.getOrigin());

      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (checkOverSegment()) {
      // insert point
      const insertIndex = model.activeState.getIndex() + 1;
      const newHandle = model.widgetState.addHandle({ insertIndex });
      const coords = getWorldCoords(event);
      if (!coords) throw new Error('No world coords');
      newHandle.setOrigin(coords);
      // enable dragging immediately
      publicAPI.activateHandle({
        selectedState: newHandle,
        representation: model.representations[0].getActors()[0], // first actor is GlyphMapper for handles
      });
      overUnselectedHandle = true;
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

  publicAPI.handleMouseMove = (event: vtkMouseEvent) => {
    if (
      model.pickable &&
      model.dragable &&
      model.activeState &&
      !ignoreKey(event)
    ) {
      if (updateActiveStateHandle(event) === macro.EVENT_ABORT) {
        return macro.EVENT_ABORT;
      }
    }

    // widgetManager.getSelections() updates on mouse move and not animating.
    // (Widget triggers animation when dragging.)
    // So we can rely on getSelections() to be up to date now.
    overUnselectedHandle = false;

    if (model.hasFocus) {
      model._widgetManager.disablePicking();
    }

    publicAPI.invokeHoverEvent({
      ...event,
      hovering: !!model.activeState,
    });

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag
  // --------------------------------------------------------------------------

  // Detect double click by comparing these values.
  let lastReleaseTime = 0;
  let lastReleasePosition: Vector3 | undefined;

  publicAPI.handleLeftButtonRelease = (event: vtkMouseEvent) => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable
    ) {
      return macro.VOID;
    }

    if (model._isDragging) {
      model._apiSpecificRenderWindow.setCursor('pointer');
      model._interactor.cancelAnimation(publicAPI);
      model._isDragging = false;
      model._widgetManager.enablePicking();
      // So a following left click without moving the mouse can immediately grab the handle,
      // we don't call model.widgetState.deactivate() here.

      publicAPI.invokeEndInteractionEvent();
      return macro.EVENT_ABORT;
    }

    // If not placing, (and not dragging) don't consume event
    // so camera control widgets can react.
    if (!model.widgetState.getPlacing()) {
      return macro.VOID;
    }

    // Double click? Then finish.
    const currentDisplayPos = [
      event.position.x,
      event.position.y,
      event.position.z,
    ] as Vector3;

    const distance = lastReleasePosition
      ? distance2BetweenPoints(currentDisplayPos, lastReleasePosition)
      : Number.POSITIVE_INFINITY;
    lastReleasePosition = currentDisplayPos;

    const currentTime = Date.now();
    const elapsed = currentTime - lastReleaseTime;

    const distanceThreshold =
      DOUBLE_CLICK_SLIP_DISTANCE_MAX_SQUARED *
      model._apiSpecificRenderWindow.getComputedDevicePixelRatio();

    if (elapsed < DOUBLE_CLICK_TIMEOUT && distance < distanceThreshold) {
      const handles = model.widgetState.getHandles();
      // Need 3 handles to finish.  Double click created 2 handles, 1 extra.
      if (handles.length >= 4) {
        removeLastHandle();
        finishPlacing();
      }
    }
    lastReleaseTime = currentTime;

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
    if (model.widgetState.getPlacing() && key === 'Escape') {
      reset();
      return macro.EVENT_ABORT;
    }

    if (model.widgetState.getPlacing() && key === 'Enter') {
      if (model.widgetState.getHandles().length >= 3) {
        finishPlacing();
      }
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  // Called when mouse moves off handle.
  publicAPI.deactivateAllHandles = () => {
    model.widgetState.deactivate();
    // Context menu should only show if hovering over the tool.
    // Stops right clicking anywhere showing context menu.
    model.activeState = null;
  };

  // --------------------------------------------------------------------------
  // Right press: Remove last handle / Pop context menu
  // --------------------------------------------------------------------------

  const makeWidgetActions = () => {
    const widgetActions: Array<WidgetAction> = [];

    const { activeState } = model;

    const overSegment = checkOverSegment();
    // if hovering on handle and we will still have at least 2 points after removing handle
    if (!overSegment && model.widgetState.getHandles().length > 2) {
      widgetActions.push({
        name: 'Delete Point',
        func: () => {
          model.widgetState.removeHandle(activeState.getIndex());
        },
      });
    }

    return widgetActions;
  };

  publicAPI.handleRightButtonPress = (eventData: any) => {
    if (ignoreKey(eventData) || !model.activeState) {
      return macro.VOID;
    }

    if (model.widgetState.getPlacing()) {
      removeLastHandle();
      return macro.EVENT_ABORT;
    }

    const eventWithWidgetAction = {
      ...eventData,
      widgetActions: makeWidgetActions(),
    };

    publicAPI.invokeRightClickEvent(eventWithWidgetAction);
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Focused means PolygonWidget is in initial drawing/placing mode.
  // After first point dropped, make moveHandle follow mouse.
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

  // Called after we are finished/placed.
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
