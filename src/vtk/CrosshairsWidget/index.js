import macro from '@kitware/vtk.js/macro';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlanePointManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';

import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';

import stateGenerator from './state';
import widgetBehavior from './behavior';

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkCrosshairsWidget(publicAPI, model) {
  model.classHierarchy.push('vtkCrosshairsWidget');

  // --- Widget Requirement ---------------------------------------------------

  model.behavior = widgetBehavior;
  model.widgetState = stateGenerator();

  publicAPI.getRepresentationsForViewType = (viewType) => {
    switch (viewType) {
      case ViewTypes.DEFAULT:
      case ViewTypes.GEOMETRY:
      case ViewTypes.SLICE:
      case ViewTypes.VOLUME:
      default:
        return [];
    }
  };

  // --------------------------------------------------------------------------
  // initialization
  // --------------------------------------------------------------------------

  // Default manipulator
  model.manipulator = vtkPlanePointManipulator.newInstance();
}

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  // manipulator: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkAbstractWidgetFactory.extend(publicAPI, model, initialValues);
  macro.setGet(publicAPI, model, ['manipulator']);

  vtkCrosshairsWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkCrosshairsWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
