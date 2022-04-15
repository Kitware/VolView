import macro from '@kitware/vtk.js/macro';

import vtkSliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/SliceRepresentationProxy';

const SLICE_MODE_MAP = {
  X: 'I',
  Y: 'J',
  Z: 'K',
  I: 'I',
  J: 'J',
  K: 'K',
};

function vtkIJKSliceRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkIJKSliceRepresentationProxy');

  const superClass = { ...publicAPI };

  // don't set colors on slices
  publicAPI.setColorBy = () => {};

  // pretend XYZ slicing is actually just IJK.
  publicAPI.setSlicingMode = (modeString) => {
    superClass.setSlicingMode(SLICE_MODE_MAP[modeString]);
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Object methods
  vtkSliceRepresentationProxy.extend(publicAPI, model);

  // Object specific methods
  vtkIJKSliceRepresentationProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkIJKSliceRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
