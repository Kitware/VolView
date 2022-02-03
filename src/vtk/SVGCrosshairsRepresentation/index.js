import macro from '@kitware/vtk.js/macro';
import vtkSVGRepresentation from '@kitware/vtk.js/Widgets/SVG/SVGRepresentation';

const { createSvgElement } = vtkSVGRepresentation;

// ----------------------------------------------------------------------------
// vtkSVGCrosshairsRepresentation
// ----------------------------------------------------------------------------

function vtkSVGCrosshairsRepresentation(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkSVGCrosshairsRepresentation');

  publicAPI.render = (widgetState) => {
    const list = publicAPI.getRepresentationStates(widgetState);

    if (list.length !== 1) {
      // shouldn't happen
      return null;
    }

    const coords = [list[0].getOrigin()];

    return publicAPI.worldPointsToPixelSpace(coords).then((pixelSpace) => {
      const point2d = pixelSpace.coords[0];
      const winHeight = pixelSpace.windowSize[1];

      const root = createSvgElement('g');
      const vline1 = createSvgElement('line');
      const vline2 = createSvgElement('line');
      const hline1 = createSvgElement('line');
      const hline2 = createSvgElement('line');

      Object.keys(model.verticalLineProps || {}).forEach((prop) => {
        vline1.setAttribute(prop, model.verticalLineProps[prop]);
        vline2.setAttribute(prop, model.verticalLineProps[prop]);
      });

      Object.keys(model.horizontalLineProps || {}).forEach((prop) => {
        hline1.setAttribute(prop, model.horizontalLineProps[prop]);
        hline2.setAttribute(prop, model.horizontalLineProps[prop]);
      });

      const [x, invY] = point2d;
      const y = winHeight - invY;

      vline1.setAttribute('x1', x);
      vline1.setAttribute('y1', '0%');
      vline1.setAttribute('x2', x);
      vline1.setAttribute('y2', y - model.centerGapRadius);
      vline2.setAttribute('x1', x);
      vline2.setAttribute('y1', y + model.centerGapRadius);
      vline2.setAttribute('x2', x);
      vline2.setAttribute('y2', '100%');

      hline1.setAttribute('x1', '0%');
      hline1.setAttribute('y1', y);
      hline1.setAttribute('x2', x - model.centerGapRadius);
      hline1.setAttribute('y2', y);
      hline2.setAttribute('x1', x + model.centerGapRadius);
      hline2.setAttribute('y1', y);
      hline2.setAttribute('x2', '100%');
      hline2.setAttribute('y2', y);

      root.appendChild(vline1);
      root.appendChild(vline2);
      root.appendChild(hline1);
      root.appendChild(hline2);

      return root;
    });
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  verticalLineProps: {
    stroke: 'green',
    'stroke-width': 2,
  },
  horizontalLineProps: {
    stroke: 'green',
    'stroke-width': 2,
  },
  centerGapRadius: 30,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkSVGRepresentation.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, [
    'horizontalLineProps',
    'verticalLineProps',
    'centerGapRadius',
  ]);

  // Object specific methods
  vtkSVGCrosshairsRepresentation(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkSVGCrosshairsRepresentation'
);

// ----------------------------------------------------------------------------

export default { extend, newInstance };
