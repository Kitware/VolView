import macro from 'vtk.js/Sources/macro';
import vtkSVGRepresentation from 'vtk.js/Sources/Widgets/SVG/SVGRepresentation';

const { createSvgElement } = vtkSVGRepresentation;

// ----------------------------------------------------------------------------
// vtkSVGCircleHandleRepresentation
// ----------------------------------------------------------------------------

function vtkSVGCircleHandleRepresentation(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkSVGCircleHandleRepresentation');

  publicAPI.render = () => {
    const list = publicAPI.getRepresentationStates();

    const coords = [];
    for (let i = 0; i < list.length; i++) {
      coords.push(list[i].getOrigin());
    }

    return publicAPI.worldPointsToPixelSpace(coords).then((pixelSpace) => {
      const points2d = pixelSpace.coords;
      const winHeight = pixelSpace.windowSize[1];

      const root = createSvgElement('g');

      for (let i = 0; i < points2d.length; i++) {
        const state = list[i];
        const xy = points2d[i];
        const x = xy[0];
        const y = winHeight - xy[1];

        if (!state.isVisible || state.isVisible()) {
          const circle = createSvgElement('circle');
          Object.keys(model.circleProps || {}).forEach((prop) =>
            circle.setAttribute(prop, model.circleProps[prop])
          );
          circle.setAttribute('cx', x);
          circle.setAttribute('cy', y);

          root.appendChild(circle);
        }
      }

      return root;
    });
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = (initialValues) => ({
  ...initialValues,
  circleProps: {
    r: 8,
    stroke: 'green',
    'stroke-width': 3,
    fill: 'transparent',
    ...initialValues?.circleProps,
  },
});

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  vtkSVGRepresentation.extend(publicAPI, model, initialValues);

  Object.assign(model, DEFAULT_VALUES(initialValues));

  macro.setGet(publicAPI, model, ['circleProps']);

  // Object specific methods
  vtkSVGCircleHandleRepresentation(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkSVGCircleHandleRepresentation'
);

// ----------------------------------------------------------------------------

export default { extend, newInstance };
