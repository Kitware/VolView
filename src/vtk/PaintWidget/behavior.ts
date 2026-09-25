import macro from '@kitware/vtk.js/macro';
import { computeWorldCoords } from '@/src/vtk/ToolWidgetUtils/utils';

export function shouldIgnoreEvent(e: any) {
  return e.altKey || e.controlKey || e.shiftKey;
}

export default function widgetBehavior(publicAPI: any, model: any) {
  model.classHierarchy.push('vtkPaintWidgetProp');

  const getWorldCoords = computeWorldCoords(model);

  // support setting per-view widget manipulators
  macro.setGet(publicAPI, model, ['manipulator', 'sampling']);

  let isPainting = false;
  let samplingStroke = false;

  const setSampling = publicAPI.setSampling;
  publicAPI.setSampling = (sampling: boolean) => {
    // Once a gesture samples, it cannot resume writing before a fresh press.
    if (sampling && isPainting) samplingStroke = true;
    return setSampling(sampling);
  };

  /**
   * Starts painting
   */
  publicAPI.handleLeftButtonPress = (eventData: any) => {
    if (
      !model.manipulator ||
      (!model.sampling && shouldIgnoreEvent(eventData))
    ) {
      return macro.VOID;
    }

    const worldCoords = getWorldCoords(eventData);
    if (!worldCoords.length) {
      return macro.VOID;
    }

    const brush = model.widgetState.getBrush();
    brush.setOrigin(...worldCoords);

    isPainting = true;
    samplingStroke = !!model.sampling;
    publicAPI.invokeStartInteractionEvent({ sampling: samplingStroke });
    return macro.EVENT_ABORT;
  };

  /**
   * Paints
   */
  publicAPI.handleMouseMove = (eventData: any) => {
    if (isPainting && !model.sampling && shouldIgnoreEvent(eventData)) {
      return macro.VOID;
    }

    const worldCoords = getWorldCoords(eventData);

    if (!worldCoords.length) {
      return macro.VOID;
    }

    const brush = model.widgetState.getBrush();
    brush.setOrigin(...worldCoords);

    if (isPainting) {
      if (!samplingStroke) publicAPI.invokeInteractionEvent();
      return macro.EVENT_ABORT;
    }

    // Let interactor get event
    return macro.VOID;
  };

  /**
   * Finishes paint
   */
  publicAPI.handleLeftButtonRelease = () => {
    if (!isPainting) {
      return macro.VOID;
    }

    isPainting = false;
    if (!samplingStroke) publicAPI.invokeEndInteractionEvent();
    return macro.EVENT_ABORT;
  };

  publicAPI.handleMouseWheel = () => {
    if (isPainting) {
      return macro.EVENT_ABORT;
    }
    return macro.VOID;
  };
}
