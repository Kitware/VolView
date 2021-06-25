import macro from 'vtk.js/Sources/macro';
import vtkSlicedGeometryRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SlicedGeometryRepresentationProxy';

import vtkCachedCutter from '../CachedCutter';

function vtkCutGeometryRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkCutGeometryRepresentationProxy');

  const oldCutter = model.cutter;
  model.cutter = vtkCachedCutter.newInstance();
  model.cutter.setCutFunction(oldCutter.getCutFunction());
  model.mapper.setInputConnection(model.cutter.getOutputPort());
  const idx = model.sourceDependencies.indexOf(oldCutter);
  model.sourceDependencies.splice(idx, 1);
  model.sourceDependencies.push(model.cutter);
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
  'vtkCutGeometryRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
