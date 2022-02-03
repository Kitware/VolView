import macro from '@kitware/vtk.js/macro';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkPlanePointManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import vtkSphereHandleRepresentation from '@kitware/vtk.js/Widgets/Representations/SphereHandleRepresentation';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';

import vtkSVGLineRepresentation from '@/src/vtk/SVGLineRepresentation';
import vtkSVGLabelRepresentation from '@/src/vtk/SVGLabelRepresentation';
import vtkSVGCircleHandleRepresentation from '@/src/vtk/SVGCircleHandleRepresentation';

import widgetBehavior from './behavior';
import stateGenerator, {
  computeInteractionState,
  InteractionState,
} from './state';

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

function vtkRulerWidget(publicAPI, model) {
  model.classHierarchy.push('vtkRulerWidget');

  // --- Widget Requirement ---------------------------------------------------

  model.methodsToLink = [
    'activeScaleFactor',
    'activeColor',
    'useActiveColor',
    'glyphResolution',
    'defaultScale',
    'text',
    'textStateIndex',
  ];
  model.behavior = widgetBehavior;
  model.widgetState = stateGenerator();

  publicAPI.getRepresentationsForViewType = () => [
    {
      builder: vtkSphereHandleRepresentation,
      labels: ['handles'],
      initialValues: {
        scaleInPixels: true,
      },
    },
    {
      builder: vtkSphereHandleRepresentation,
      labels: ['moveHandle'],
      initialValues: {
        scaleInPixels: true,
      },
    },
    {
      builder: vtkSVGCircleHandleRepresentation,
      labels: ['handles', 'moveHandle'],
      initialValues: {
        circleProps: {
          r: 6,
          stroke: '#ffff00',
        },
      },
    },
    {
      builder: vtkSVGLineRepresentation,
      labels: ['handles', 'moveHandle'],
      initialValues: {
        lineProps: {
          stroke: '#ffff00',
        },
      },
    },
    {
      builder: vtkSVGLabelRepresentation,
      labels: ['handles'],
      initialValues: {
        textProps: {
          fill: '#ffff00',
        },
      },
    },
  ];

  // --- Public methods -------------------------------------------------------

  publicAPI.addPoint = (point) => {
    if (
      computeInteractionState(model.widgetState) !== InteractionState.Complete
    ) {
      const newHandle = model.widgetState.addHandle();
      newHandle.setOrigin(...point);
    }
  };

  publicAPI.clearPoints = () => {
    model.widgetState.clearHandleList();
  };

  publicAPI.getDistance = () => {
    const handles = model.widgetState.getHandleList();
    if (handles.length !== 2) {
      return 0;
    }
    return Math.sqrt(
      distance2BetweenPoints(handles[0].getOrigin(), handles[1].getOrigin())
    );
  };

  // --------------------------------------------------------------------------
  // initialization
  // --------------------------------------------------------------------------

  model.widgetState.onBoundsChange((bounds) => {
    const center = [
      (bounds[0] + bounds[1]) * 0.5,
      (bounds[2] + bounds[3]) * 0.5,
      (bounds[4] + bounds[5]) * 0.5,
    ];
    model.widgetState.getMoveHandle().setOrigin(center);
  });

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

  vtkRulerWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkRulerWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
