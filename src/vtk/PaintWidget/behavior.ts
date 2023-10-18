import macro from '@kitware/vtk.js/macro';

export function shouldIgnoreEvent(e: any) {
  return e.altKey || e.controlKey || e.shiftKey;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkPaintWidgetProp');

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator']);

  let isPainting = false;

  /**
   * Starts painting
   */
  publicAPI.handleLeftButtonPress = (eventData: any) => {
    if (!model.manipulator || shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    const { worldCoords } = model.manipulator.handleEvent(
      eventData,
      model._apiSpecificRenderWindow
    );

    if (!worldCoords) {
      return macro.VOID;
    }

    const brush = model.widgetState.getBrush();
    brush.setOrigin(...worldCoords);

    isPainting = true;
    publicAPI.invokeStartInteractionEvent();
    return macro.EVENT_ABORT;
  };

  /**
   * Paints
   */
  publicAPI.handleMouseMove = (eventData: any) => {
    if (shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    const { worldCoords } = model.manipulator.handleEvent(
      eventData,
      model._apiSpecificRenderWindow
    );

    if (!worldCoords) {
      return macro.VOID;
    }

    const brush = model.widgetState.getBrush();
    brush.setOrigin(...worldCoords);

    if (isPainting) {
      publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    // Let interactor get event
    return macro.VOID;
  };

  /**
   * Finishes paint
   */
  publicAPI.handleLeftButtonRelease = (eventData: any) => {
    if (!isPainting || shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    isPainting = false;
    publicAPI.invokeEndInteractionEvent();
    return macro.EVENT_ABORT;
  };

  publicAPI.handleMouseWheel = () => {
    if (isPainting) {
      return macro.EVENT_ABORT;
    }
    return macro.VOID;
  };

  publicAPI.grabFocus = () => {
    if (!model.hasFocus) {
      model.hasFocus = true;
      model._interactor.requestAnimation(publicAPI);
    }
  };

  publicAPI.loseFocus = () => {
    if (model.hasFocus) {
      model._interactor.cancelAnimation(publicAPI);
    }
    model.hasFocus = false;
    // model._widgetManager.enablePicking();
    // model._interactor.render();
  };
}
