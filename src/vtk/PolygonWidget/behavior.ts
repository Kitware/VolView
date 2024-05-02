import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import macro from '@kitware/vtk.js/macros';
import type { Vector3 } from '@kitware/vtk.js/types';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';

import { WidgetAction } from '@/src/vtk/ToolWidgetUtils/types';
import { computeWorldCoords } from '@/src/vtk/ToolWidgetUtils/utils';

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

  const setDragging = (isDragging: boolean) => {
    model._dragging = isDragging;
    publicAPI.invokeDraggingEvent({
      dragging: isDragging,
    });
  };

  // overUnselectedHandle is true if mouse is over handle that was created before a mouse move event.
  // That happens if creating new handle and immediately dragging.
  // Then widgetManager.getSelections() still points to the last actor
  // after the mouse button is released. In this widgets case, the last actor is part of the LineGlyphRepresentation.
  // overUnselectedHandle tracks if the mouse is over the new handle so we
  // don't create a another handle when clicking after without mouse move.
  // A mouse move event sets overUnselectedHandle to false as we can then rely on widgetManager.getSelections().
  let overUnselectedHandle = false;

  let freeHanding = false;

  // Check if mouse is over line segment between handles
  const checkOverSegment = () => {
    // overSegment guards against clicking anywhere in view
    const selections = model._widgetManager.getSelections();
    const overSegment =
      selections?.[0]?.getProperties().prop ===
      model.representations[1].getActors()[0]; // line representation is second representation
    return overSegment && !overUnselectedHandle;
  };

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);

  // events to emit
  macro.event(publicAPI, model, 'RightClickEvent');
  macro.event(publicAPI, model, 'PlacedEvent');
  macro.event(publicAPI, model, 'HoverEvent');
  macro.event(publicAPI, model, 'DraggingEvent');

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

  const getWorldCoords = computeWorldCoords(model);

  // returns macro.EVENT_ABORT if dragging handle or finishing
  // to indicate event should be consumed.
  function updateActiveStateHandle(callData: any) {
    const worldCoords = getWorldCoords(callData);

    if (
      worldCoords?.length &&
      (model.activeState === model.widgetState.getMoveHandle() ||
        model._dragging)
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

  function addHandle() {
    const moveHandle = model.widgetState.getMoveHandle();
    const newHandle = model.widgetState.addHandle();
    newHandle.setOrigin(moveHandle.getOrigin());
  }

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag / Add new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (event: vtkMouseEvent) => {
    const activeWidget = model._widgetManager.getActiveWidget();

    if (
      !model.manipulator ||
      ignoreKey(event) ||
      // If hovering over another widget, don't consume event.
      (activeWidget && activeWidget !== publicAPI)
    ) {
      return macro.VOID;
    }

    if (checkOverSegment()) {
      return macro.VOID;
    }

    // Drop point?
    const manipulator =
      model.activeState?.getManipulator?.() ?? model.manipulator;
    if (model.widgetState.getPlacing() && manipulator) {
      // Dropping first point?
      if (model.widgetState.getHandles().length === 0) {
        // update variables used by updateActiveStateHandle
        model.activeState = model.widgetState.getMoveHandle();
        model._widgetManager.grabFocus(publicAPI);
      }
      updateActiveStateHandle(event);

      if (model.widgetState.getFinishable()) {
        finishPlacing();
        // Don't add another point, just return
        return macro.EVENT_ABORT;
      }

      addHandle();
      publicAPI.invokeStartInteractionEvent();
      freeHanding = true;
      return macro.EVENT_ABORT;
    }

    if (model.activeState?.getActive() && model.pickable && model.dragable) {
      setDragging(true);
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
      !ignoreKey(event) &&
      updateActiveStateHandle(event) === macro.EVENT_ABORT // side effect!
    ) {
      if (freeHanding) {
        addHandle();
      }
      return macro.EVENT_ABORT; // consume event
    }

    // widgetManager.getSelections() updates on mouse move and not animating.
    // (Widget triggers animation when dragging.)
    // So we can rely on getSelections() to be up to date now
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

  // Detect double click by diffing these.
  let lastReleaseTime = 0;
  let lastReleasePosition: Vector3 | undefined;
  function isDoubleClick(event: vtkMouseEvent) {
    const currentTime = Date.now();
    const currentDisplayPos = [
      event.position.x,
      event.position.y,
      event.position.z,
    ] as Vector3;
    const elapsed = currentTime - lastReleaseTime;

    const distance = lastReleasePosition
      ? distance2BetweenPoints(
          [event.position.x, event.position.y, event.position.z],
          lastReleasePosition
        )
      : Number.POSITIVE_INFINITY;

    const doubleClicked =
      elapsed < DOUBLE_CLICK_TIMEOUT &&
      distance < DOUBLE_CLICK_SLIP_DISTANCE_MAX_SQUARED;

    lastReleaseTime = currentTime;
    lastReleasePosition = currentDisplayPos;
    return doubleClicked;
  }

  publicAPI.handleLeftButtonRelease = (event: vtkMouseEvent) => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable
    ) {
      return macro.VOID;
    }

    freeHanding = false;

    if (model._dragging) {
      model._apiSpecificRenderWindow.setCursor('pointer');
      model._interactor.cancelAnimation(publicAPI);
      setDragging(false);
      model._widgetManager.enablePicking();
      // So a following left click without moving the mouse can immediately grab the handle,
      // we don't call model.widgetState.deactivate() here.
      publicAPI.invokeEndInteractionEvent();
      return macro.EVENT_ABORT;
    }

    // If not placing (and not dragging) don't consume event
    // so camera control widgets can react.
    if (!model.widgetState.getPlacing()) {
      return macro.VOID;
    }

    if (model.widgetState.getFinishable()) {
      finishPlacing();
    } else if (isDoubleClick(event)) {
      // try to finish placing
      const handles = model.widgetState.getHandles();
      // Need 3 handles to finish.  Double click created 2 handles, 1 extra.
      if (handles.length >= 4) {
        removeLastHandle();
        finishPlacing();
      }
    }

    if (
      (model.hasFocus && !model.activeState) ||
      (model.activeState && !model.activeState.getActive())
    ) {
      // update if mouse hovered over handle/activeState for next onDown
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

  const makeWidgetActions = (eventData: any) => {
    const widgetActions: Array<WidgetAction> = [];

    const { activeState } = model;

    const overSegment = checkOverSegment();

    if (overSegment) {
      // Allow inserting ponts when over a segment
      widgetActions.push({
        name: 'Add Point',
        func: () => {
          const insertIndex = activeState.getIndex() + 1;
          const newHandle = model.widgetState.addHandle({ insertIndex });
          const coords = getWorldCoords(eventData);
          if (!coords) throw new Error('No world coords');
          newHandle.setOrigin(coords);
          // enable dragging immediately
          publicAPI.activateHandle({
            selectedState: newHandle,
            representation: model.representations[0].getActors()[0], // first actor is GlyphMapper for handles
          });
        },
      });
    } else if (!overSegment && model.widgetState.getHandles().length > 2) {
      // if hovering on handle and we will still have at least 2 points after removing handle
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
      widgetActions: makeWidgetActions(eventData),
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
  };

  publicAPI.delete = macro.chain(() => {
    publicAPI.resetInteractions();
  }, publicAPI.delete);
}
