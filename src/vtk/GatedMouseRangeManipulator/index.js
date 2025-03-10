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

  const cleanupListener = () => {
    model.mouseMoveListenerSubscription?.unsubscribe();
    model.mouseMoveListenerSubscription = null;
  };

  publicAPI.setupMouseMove = (interactor) => {
    cleanupListener();
    model.mouseMoveListenerSubscription = interactor.onMouseMove((event) => {
      const invertY = {
        ...event.position,
        y: interactor.getView().getSize()[1] - event.position.y,
      };
      if (model.newInteraction) {
        model.newInteraction = false;
        publicAPI.onButtonDown(interactor, event.pokedRenderer, invertY);
      }
      publicAPI.onMouseMove(interactor, event.pokedRenderer, invertY);
    });
  };

  publicAPI.delete = macro.chain(publicAPI.delete, cleanupListener);
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
