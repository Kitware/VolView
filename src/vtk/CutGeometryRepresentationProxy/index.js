import macro from 'vtk.js/Sources/macro';

import vtkSlicedGeometryRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SlicedGeometryRepresentationProxy';

import vtkPolyDataTransformFilter from '../PolyDataTransformFilter';
import vtkRepresentationProxyTransformMixin from '../transformMixin';

function vtkCutGeometryRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkCutGeometryRepresentationProxy');
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

  vtkRepresentationProxyTransformMixin(vtkPolyDataTransformFilter)(
    publicAPI,
    model
  );

  // Object specific methods
  vtkCutGeometryRepresentationProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkCutGeometryRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
