import macro from '@kitware/vtk.js/macro';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlanePointManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkSphereHandleRepresentation from '@kitware/vtk.js/Widgets/Representations/SphereHandleRepresentation';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';

import widgetBehavior from './behavior';
import stateGenerator, { PointsLabel } from './state';

export { shouldIgnoreEvent } from './behavior';

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkRectangleWidget(publicAPI, model) {
  model.classHierarchy.push('vtkRectangleWidget');

  // --- Widget Requirement ---------------------------------------------------

  publicAPI.getRepresentationsForViewType = () => [
    {
      builder: vtkSphereHandleRepresentation,
      labels: [PointsLabel],
      initialValues: {
        scaleInPixels: true,
      },
    },
  ];

  publicAPI.getLength = () => {
    const first = model.widgetState.getFirstPoint().getOrigin();
    const second = model.widgetState.getSecondPoint().getOrigin();
    if (!first || !second) {
      return 0;
    }
    return Math.sqrt(distance2BetweenPoints(first, second));
  };

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
    widgetState: stateGenerator(initialValues),
  });
  macro.get(publicAPI, model, ['manipulator']);

  vtkRectangleWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkRectangleWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
