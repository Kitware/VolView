import macro from 'vtk.js/Sources/macro';
import vtkSVGRepresentation from 'vtk.js/Sources/Widgets/SVG/SVGRepresentation';
import { norm } from 'vtk.js/Sources/Common/Core/Math';

const { createSvgElement } = vtkSVGRepresentation;

function normalize2(v) {
  const l = norm(v, 2);
  if (l > 0) {
    return [v[0] / l, v[1] / l];
  }
  return [0, 0];
}

// ----------------------------------------------------------------------------
// vtkSVGLabelRepresentation
// ----------------------------------------------------------------------------

function vtkSVGLabelRepresentation(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkSVGLabelRepresentation');

  publicAPI.render = (widgetState) => {
    const list = publicAPI.getRepresentationStates(widgetState);

    const state = list[model.textStateIndex];
    const coords = [];
    if (state && (!state.isVisible || state.isVisible())) {
      coords.push(state.getOrigin());
    }

    const prevState = list[model.textStateIndex - 1];
    if (prevState && (!prevState.isVisible || prevState.isVisible())) {
      coords.push(prevState.getOrigin());
    }

    const nextState = list[model.textStateIndex + 1];
    if (nextState && (!nextState.isVisible || nextState.isVisible())) {
      coords.push(nextState.getOrigin());
    }

    return publicAPI.worldPointsToPixelSpace(coords).then((pixelSpace) => {
      const coords2d = pixelSpace.coords[0];
      const winHeight = pixelSpace.windowSize[1];

      const text = createSvgElement('text');
      Object.keys(model.textProps || {}).forEach((prop) =>
        text.setAttribute(prop, model.textProps[prop])
      );

      if (coords2d) {
        let dx = 0;
        let dy = 1;
        if (pixelSpace.coords.length === 1) {
          dx = 1; // put text in top-right
        }
        if (pixelSpace.coords.length === 2) {
          // line widget
          const c1 = pixelSpace.coords[1];
          if (c1[1] - coords2d[1] > 0) {
            dy = -1;
          }
        } else if (pixelSpace.coords.length === 3) {
          // angle widget
          const c1 = pixelSpace.coords[1];
          const c2 = pixelSpace.coords[2];
          const v1 = normalize2([c1[0] - coords2d[0], c1[1] - coords2d[1]]);
          const v2 = normalize2([c2[0] - coords2d[0], c2[1] - coords2d[1]]);

          // negative bisector, defaulting to 1 if sign is 0
          dx = Math.sign(-(v1[0] + v2[0])) || 1;
          dy = Math.sign(-(v1[1] + v2[1])) || 1;
        }

        // canvas->svg inverts the Y coordinate
        dy *= -1;

        const alignment = dy === 1 ? 'hanging' : 'baseline';
        const anchor = dx === 1 ? 'start' : 'end';

        text.setAttribute('x', coords2d[0]);
        text.setAttribute('y', winHeight - coords2d[1]);
        text.setAttribute('dx', model.offset * dx);
        text.setAttribute('dy', model.offset * dy);
        text.setAttribute('alignment-baseline', alignment);
        text.setAttribute('text-anchor', anchor);
        text.textContent = model.text;
      }

      return text;
    });
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = (initialValues) => ({
  text: 'Label',
  textStateIndex: 0,
  offset: 12,
  ...initialValues,
  textProps: {
    fill: '#ff0000',
    ...initialValues?.textProps,
  },
});

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  vtkSVGRepresentation.extend(publicAPI, model, initialValues);

  Object.assign(model, DEFAULT_VALUES(initialValues));

  macro.setGet(publicAPI, model, ['textStateIndex', 'textProps', 'text']);

  // Object specific methods
  vtkSVGLabelRepresentation(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkSVGLabelRepresentation'
);

// ----------------------------------------------------------------------------

export default { extend, newInstance };
