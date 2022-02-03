import macro from '@kitware/vtk.js/macro';
import { InteractionState, computeInteractionState } from './state';

export default function widgetBehavior(publicAPI, model) {
  model.classHierarchy.push('vtkRulerWidgetProp');

  let isDragging = null;
  let manipulatorListener = null;

  function ignoreKey(e) {
    return e.altKey || e.controlKey || e.shiftKey;
  }

  publicAPI.setDisplayCallback = (callback) =>
    model.representations[0].setDisplayCallback(callback);

  publicAPI.addPoint = model.factory.addPoint;
  publicAPI.clearPoints = model.factory.clearPoints;
  publicAPI.getDistance = model.factory.getDistance;

  // --------------------------------------------------------------------------
  // Scroll: update point on manipulator change
  // --------------------------------------------------------------------------

  publicAPI.handleStartMouseWheel = (e) => {
    if (
      model.activeState &&
      model.activeState.getActive() &&
      model.pickable &&
      !ignoreKey(e) &&
      computeInteractionState(model.widgetState) !== InteractionState.Complete
    ) {
      if (manipulatorListener) {
        manipulatorListener.unsubscribe();
      }
      manipulatorListener = model.manipulator.onModified(() =>
        publicAPI.handleMouseMove(e)
      );
    }
  };

  publicAPI.handleEndMouseWheel = () => {
    if (manipulatorListener) {
      manipulatorListener.unsubscribe();
      manipulatorListener = null;
    }
  };

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e) => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable ||
      ignoreKey(e)
    ) {
      return macro.VOID;
    }

    if (
      model.activeState === model.widgetState.getMoveHandle() &&
      computeInteractionState(model.widgetState) !== InteractionState.Complete
    ) {
      // Commit handle to location
      const moveHandle = model.widgetState.getMoveHandle();
      const point = moveHandle.getOrigin();
      publicAPI.addPoint(point);
    } else {
      isDragging = true;
      model.openGLRenderWindow.setCursor('grabbing');
      model.interactor.requestAnimation(publicAPI);
    }

    publicAPI.invokeStartInteractionEvent();
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData) => {
    if (
      model.hasFocus &&
      computeInteractionState(model.widgetState) === InteractionState.Complete
    ) {
      publicAPI.loseFocus();
      return macro.VOID;
    }

    if (
      model.pickable &&
      model.manipulator &&
      model.activeState &&
      model.activeState.getActive() &&
      !ignoreKey(callData)
    ) {
      const worldCoords = model.manipulator.handleEvent(
        callData,
        model.openGLRenderWindow
      );

      if (
        worldCoords.length &&
        (model.activeState === model.widgetState.getMoveHandle() || isDragging)
      ) {
        model.activeState.setOrigin(worldCoords);
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
      model.openGLRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model.interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
    } else if (model.activeState !== model.widgetState.getMoveHandle()) {
      model.widgetState.deactivate();
    }

    if (
      (model.hasFocus && !model.activeState) ||
      (model.activeState && !model.activeState.getActive())
    ) {
      publicAPI.invokeEndInteractionEvent();
      model.widgetManager.enablePicking();
      model.interactor.render();
    }

    isDragging = false;
  };

  // --------------------------------------------------------------------------
  // Focus API - modeHandle follow mouse when widget has focus
  // --------------------------------------------------------------------------

  publicAPI.grabFocus = () => {
    if (
      !model.hasFocus &&
      computeInteractionState(model.widgetState) !== InteractionState.Complete
    ) {
      model.activeState = model.widgetState.getMoveHandle();
      model.activeState.activate();
      model.activeState.setVisible(true);
      model.interactor.requestAnimation(publicAPI);
      publicAPI.invokeStartInteractionEvent();
    }
    model.hasFocus = true;
  };

  // --------------------------------------------------------------------------

  publicAPI.loseFocus = () => {
    if (model.hasFocus) {
      model.interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
    }
    model.widgetState.deactivate();
    model.widgetState.getMoveHandle().deactivate();
    model.widgetState.getMoveHandle().setVisible(false);
    model.activeState = null;
    model.hasFocus = false;
    model.widgetManager.enablePicking();
    model.interactor.render();
  };
}
