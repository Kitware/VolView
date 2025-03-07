import macro from '@kitware/vtk.js/macro';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';

function vtkGatedMouseRangeManipulator(publicAPI, model) {
  model.classHierarchy.push('vtkGatedMouseRangeManipulator');

  model.gateEnabled = true;

  model.mouseMoveListener = null;
  model.viewContainer = null;
  model.newInteraction = true;

  const superOnMouseMove = publicAPI.onMouseMove;

  publicAPI.onMouseMove = (interactor, renderer, position) => {
    if (!model.gateEnabled) {
      return;
    }
    superOnMouseMove(interactor, renderer, position);
  };

  publicAPI.setGateEnabled = (enabled) => {
    model.newInteraction = !model.gateEnabled && enabled;
    model.gateEnabled = enabled;
    publicAPI.modified();
  };

  // Define the mouse move listener function outside initializeGlobalMouseMove
  const createMouseMoveListener = (interactor, renderer) => {
    return (event) => {
      // Proceed if the mouse is inside the container.
      if (!model.viewContainer.contains(event.target)) {
        return;
      }
      // Map the event client coordinates to the container's coordinate system.
      const rect = model.viewContainer.getBoundingClientRect();
      const position = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      if (model.newInteraction) {
        model.newInteraction = false;
        publicAPI.onButtonDown(interactor, renderer, position);
      }
      publicAPI.onMouseMove(interactor, renderer, position);
    };
  };

  // Initializes a global mousemove listener on the view container.
  // Only events occurring over the container will trigger onMouseMove.
  publicAPI.initializeGlobalMouseMove = (interactor, renderer, container) => {
    model.viewContainer = container;
    if (!model.mouseMoveListener) {
      model.mouseMoveListener = createMouseMoveListener(interactor, renderer);
      model.viewContainer.addEventListener(
        'mousemove',
        model.mouseMoveListener
      );
    }
  };

  publicAPI.delete = macro.chain(publicAPI.delete, () => {
    if (model.mouseMoveListener && model.viewContainer) {
      model.viewContainer.removeEventListener(
        'mousemove',
        model.mouseMoveListener
      );
      model.mouseMoveListener = null;
    }
  });
}

function extend(publicAPI, model, initialValues = {}) {
  vtkMouseRangeManipulator.extend(publicAPI, model, initialValues);
  Object.assign(model, {
    gateEnabled: true,
    mouseMoveListener: null,
    viewContainer: null,
  });
  vtkGatedMouseRangeManipulator(publicAPI, model);
}

export const newInstance = macro.newInstance(
  extend,
  'vtkGatedMouseRangeManipulator'
);

export default { newInstance, extend };
