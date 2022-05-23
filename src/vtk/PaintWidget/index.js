import macro from '@kitware/vtk.js/macro';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlanePointManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkPaintBrushContextRepresentation from '@/src/vtk/PaintBrushContextRepresentation';

import widgetBehavior from './behavior';
import stateGenerator from './state';

export { shouldIgnoreEvent } from './behavior';

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkPaintWidget(publicAPI, model) {
  model.classHierarchy.push('vtkPaintWidget');

  model.methodsToLink = ['slicingIndex', 'indexToWorld', 'worldToIndex'];

  publicAPI.getRepresentationsForViewType = () => [
    {
      builder: vtkPaintBrushContextRepresentation,
      labels: ['brush'],
    },
  ];

  // Default manipulator
  model.manipulator = vtkPlanePointManipulator.newInstance();
}

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkAbstractWidgetFactory.extend(publicAPI, model, {
    ...initialValues,
    behavior: widgetBehavior,
    widgetState: stateGenerator(),
  });
  macro.get(publicAPI, model, ['manipulator']);

  vtkPaintWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkPaintWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
