import macro from '@kitware/vtk.js/macro';
import { Vector3 } from '@kitware/vtk.js/types';
import { InteractionState } from './state';

export function shouldIgnoreEvent(e: any) {
  return e.altKey || e.controlKey || e.shiftKey;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkRulerWidgetProp');

  let draggingState: any = null;

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);
  // support forwarding events
  macro.event(publicAPI, model, 'RightClickEvent');
  // finalized event
  macro.event(publicAPI, model, 'FinalizedEvent');

  // TODO this is an override to also clear activeState,
  // since this is a "passive" widget that doesn't manage
  // active state inside the focus handlers.
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

  publicAPI.resetInteractionState = () => {
    model.widgetState.setInteractionState(InteractionState.PlacingFirst);
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

    const intState = model.widgetState.getInteractionState();

    if (intState !== InteractionState.Finalized) {
      const worldCoords = model.manipulator.handleEvent(
        eventData,
        model._apiSpecificRenderWindow
      );
      if (worldCoords.length) {
        publicAPI.invokeInteractionEvent();
        if (intState === InteractionState.PlacingFirst) {
          publicAPI.setFirstPoint(worldCoords);
          model.widgetState.setInteractionState(InteractionState.PlacingSecond);
        } else if (intState === InteractionState.PlacingSecond) {
          publicAPI.setSecondPoint(worldCoords);
          model.widgetState.setInteractionState(InteractionState.Finalized);
          publicAPI.invokeFinalizedEvent();
        }
        return macro.EVENT_ABORT;
      }
    } else if (model.activeState?.getActive() && model.pickable) {
      // widget is considered finalized, so see if we
      // are trying to drag a point.
      draggingState = model.activeState;
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
    const intState = model.widgetState.getInteractionState();

    // show second point during placement
    if (intState === InteractionState.PlacingSecond) {
      const worldCoords = model.manipulator.handleEvent(
        eventData,
        model._apiSpecificRenderWindow
      );

      if (worldCoords.length) {
        model.widgetState.getSecondPoint().setOrigin(worldCoords);
        publicAPI.invokeInteractionEvent();
      }

      return macro.EVENT_ABORT;
    }

    if (draggingState) {
      const worldCoords = model.manipulator.handleEvent(
        eventData,
        model._apiSpecificRenderWindow
      );

      if (worldCoords.length) {
        draggingState.setOrigin(worldCoords);
        publicAPI.invokeInteractionEvent();
      }

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
      model.widgetState.getInteractionState() !== InteractionState.Finalized || // ignore when still placing
      !model.activeState?.getActive() || // ignore when no selected state
      model.hasFocus || // ignore when focused
      draggingState // ignore when dragging
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
