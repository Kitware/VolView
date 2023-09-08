import macro from '@kitware/vtk.js/macro';
import type { Vector3 } from '@kitware/vtk.js/types';

export enum InteractionState {
  PlacingFirst = 'PlacingFirst',
  PlacingSecond = 'PlacingSecond',
  Select = 'Select',
  Dragging = 'Dragging',
}

export function shouldIgnoreEvent(e: any) {
  return e.altKey || e.controlKey || e.shiftKey;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkRulerWidgetProp');

  model.interactionState = InteractionState.Select;
  let draggingState: any = null;

  macro.setGet(publicAPI, model, ['interactionState']);
  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);
  // support forwarding events
  macro.event(publicAPI, model, 'RightClickEvent');
  macro.event(publicAPI, model, 'PlacedEvent');

  publicAPI.deactivateAllHandles = () => {
    model.widgetState.deactivate();
    model.activeState = null;
  };

  publicAPI.setFirstPoint = (coord: Vector3) => {
    const point = model.widgetState.getFirstPoint();
    point.setOrigin(coord);
  };

  publicAPI.setSecondPoint = (coord: Vector3) => {
    const point = model.widgetState.getSecondPoint();
    point.setOrigin(coord);
  };

  const originalSetInteractionState = publicAPI.setInteractionState;
  publicAPI.setInteractionState = (state: InteractionState) => {
    const changed = originalSetInteractionState(state);
    if (changed && state === InteractionState.PlacingFirst) {
      model.widgetState.setIsPlaced(false);
      model.widgetState.getFirstPoint().setVisible(false);
      model.widgetState.getSecondPoint().setVisible(false);
    }
    return changed;
  };

  publicAPI.resetInteractions = () => {
    model._interactor.cancelAnimation(publicAPI, true);
  };

  publicAPI.resetState = () => {
    model.widgetState.getFirstPoint().setOrigin(null);
    model.widgetState.getSecondPoint().setOrigin(null);
  };

  /**
   * Places or drags a point.
   */
  publicAPI.handleLeftButtonPress = (eventData: any) => {
    if (!model.manipulator || shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    // This ruler widget is passive, so if another widget
    // is active, we don't do anything.
    const activeWidget = model._widgetManager.getActiveWidget();
    if (activeWidget && activeWidget !== publicAPI) {
      return macro.VOID;
    }

    const worldCoords = model.manipulator.handleEvent(
      eventData,
      model._apiSpecificRenderWindow
    );
    if (!worldCoords.length) {
      return macro.VOID;
    }

    const intState = publicAPI.getInteractionState();

    if (intState === InteractionState.PlacingFirst) {
      publicAPI.setFirstPoint(worldCoords);
      publicAPI.setSecondPoint(worldCoords);
      model.widgetState.getFirstPoint().setVisible(true);
      model.widgetState.getSecondPoint().setVisible(true);

      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
      publicAPI.setInteractionState(InteractionState.PlacingSecond);
      return macro.EVENT_ABORT;
    }

    if (intState === InteractionState.PlacingSecond) {
      publicAPI.setSecondPoint(worldCoords);
      model.widgetState.setIsPlaced(true);

      publicAPI.setInteractionState(InteractionState.Select);
      publicAPI.invokeEndInteractionEvent();
      publicAPI.invokePlacedEvent();

      model._interactor.cancelAnimation(publicAPI);
      return macro.EVENT_ABORT;
    }

    // dragging
    if (model.activeState?.getActive() && model.pickable) {
      draggingState = model.activeState;
      publicAPI.setInteractionState(InteractionState.Dragging);
      model._apiSpecificRenderWindow.setCursor('grabbing');
      model._interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  /**
   * Moves a point around.
   */
  publicAPI.handleMouseMove = (eventData: any) => {
    const worldCoords = model.manipulator.handleEvent(
      eventData,
      model._apiSpecificRenderWindow
    );
    if (!worldCoords.length) {
      return macro.VOID;
    }

    const intState = publicAPI.getInteractionState();

    if (intState === InteractionState.PlacingSecond) {
      model.widgetState.getSecondPoint().setOrigin(worldCoords);
      // show second point during placement
      model.widgetState.getSecondPoint().setVisible(true);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    if (
      publicAPI.getInteractionState() === InteractionState.Dragging &&
      draggingState
    ) {
      draggingState.setOrigin(worldCoords);
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    return macro.VOID;
  };

  /**
   * Finishes dragging
   */
  publicAPI.handleLeftButtonRelease = (eventData: any) => {
    if (draggingState) {
      const worldCoords = model.manipulator.handleEvent(
        eventData,
        model._apiSpecificRenderWindow
      );
      if (worldCoords.length) {
        draggingState.setOrigin(worldCoords);
      }

      draggingState = null;
      publicAPI.setInteractionState(InteractionState.Select);
      model._apiSpecificRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model._interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
      model._widgetManager.enablePicking();
    }
  };

  publicAPI.handleRightButtonPress = (eventData: any) => {
    if (
      shouldIgnoreEvent(eventData) ||
      publicAPI.getInteractionState() !== InteractionState.Select ||
      !model.activeState
    ) {
      return macro.VOID;
    }
    publicAPI.invokeRightClickEvent(eventData);
    return macro.EVENT_ABORT;
  };

  publicAPI.grabFocus = () => {
    throw new Error('grabFocus is not implemented');
  };

  publicAPI.loseFocus = () => {
    throw new Error('loseFocus is not implemented');
  };
}
