import macro from 'vtk.js/Sources/macro';

import vtkSlicedGeometryRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SlicedGeometryRepresentationProxy';

function vtkCutGeometryRepresentationProxy(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkCutGeometryRepresentationProxy');

  // TODO add contour loop filling
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Object methods
  vtkSlicedGeometryRepresentationProxy.extend(publicAPI, model);

  // Object specific methods
  vtkCutGeometryRepresentationProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkCutGeometryRepresentationProxy',
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
