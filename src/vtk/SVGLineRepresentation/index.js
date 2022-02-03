import macro from '@kitware/vtk.js/macro';
import vtkSVGRepresentation from '@kitware/vtk.js/Widgets/SVG/SVGRepresentation';

const { createSvgElement } = vtkSVGRepresentation;

// ----------------------------------------------------------------------------
// vtkSVGLineRepresentation
// ----------------------------------------------------------------------------

function vtkSVGLineRepresentation(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkSVGLineRepresentation');

  publicAPI.render = (widgetState) => {
    const list = publicAPI.getRepresentationStates(widgetState);

    const coords = [];
    for (let i = 0; i < list.length; i++) {
      const state = list[i];
      if (!state.isVisible || state.isVisible()) {
        coords.push(state.getOrigin());
      }
    }

    return publicAPI.worldPointsToPixelSpace(coords).then((pixelSpace) => {
      const points2d = pixelSpace.coords;
      const winHeight = pixelSpace.windowSize[1];

      const root = createSvgElement('g');

      for (let i = 0; i < points2d.length - 1; i++) {
        const xy = points2d[i];
        const nextXY = points2d[i + 1];
        const x1 = xy[0];
        const y1 = winHeight - xy[1];
        const x2 = nextXY[0];
        const y2 = winHeight - nextXY[1];

        const line = createSvgElement('line');

        Object.keys(model.lineProps || {}).forEach((prop) =>
          line.setAttribute(prop, model.lineProps[prop])
        );

        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);

        root.appendChild(line);
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
  lineProps: {
    stroke: 'green',
    'stroke-width': 2,
    ...initialValues?.lineProps,
  },
});

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  vtkSVGRepresentation.extend(publicAPI, model, initialValues);

  Object.assign(model, DEFAULT_VALUES(initialValues));

  macro.setGet(publicAPI, model, ['lineProps']);

  // Object specific methods
  vtkSVGLineRepresentation(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkSVGLineRepresentation'
);

// ----------------------------------------------------------------------------

export default { extend, newInstance };
