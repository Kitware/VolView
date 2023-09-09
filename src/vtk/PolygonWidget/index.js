import macro from '@kitware/vtk.js/macro';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlanePointManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkSphereHandleRepresentation from '@kitware/vtk.js/Widgets/Representations/SphereHandleRepresentation';
import { Behavior } from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation/Constants';
import vtkLineGlyphRepresentation from '@/src/vtk/LineGlyphRepresentation';
import { HandlesLabel, MoveHandleLabel } from '@/src/vtk/PolygonWidget/common';

import widgetBehavior from './behavior';
import stateGenerator from './standaloneState';

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkPolygonWidget(publicAPI, model) {
  model.classHierarchy.push('vtkPolygonWidget');

  // --- Widget Requirement ---------------------------------------------------

  publicAPI.getRepresentationsForViewType = () => [
    {
      builder: vtkSphereHandleRepresentation,
      labels: [HandlesLabel, MoveHandleLabel],
      initialValues: {
        scaleInPixels: true,
      },
    },
    {
      builder: vtkLineGlyphRepresentation,
      labels: [HandlesLabel],
      initialValues: {
        scaleInPixels: true,
        lineThickness: 0.25, // smaller than .5 default to prioritize picking handles
        behavior: Behavior.HANDLE, // make pickable even if not visible
      },
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
    behavior: widgetBehavior,
    widgetState: stateGenerator(initialValues),
    ...initialValues,
  });
  macro.get(publicAPI, model, ['manipulator']);

  vtkPolygonWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkPolygonWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
