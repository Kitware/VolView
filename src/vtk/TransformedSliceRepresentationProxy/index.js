import macro from 'vtk.js/Sources/macro';

import vtkSliceRepresentationProxy from 'vtk.js/Sources/Proxy/Representations/SliceRepresentationProxy';

import vtkImageTransformFilter from '../ImageTransformFilter';
import vtkRepresentationProxyTransformMixin from '../transformMixin';

function vtkTransformedSliceRepresentationProxy(publicAPI, model) {
  model.classHierarchy.push('vtkTransformedSliceRepresentationProxy');

  const superClass = { ...publicAPI };

  publicAPI.updateDependencies = () => {
    superClass.updateDependencies();
    // hack: set mode to something else so we can bypass
    // the "same value; do nothing" shortcut and update
    // the mapper.
    const mode = model.slicingMode;
    publicAPI.setSlicingMode(mode === 'I' ? 'J' : 'I');
    publicAPI.setSlicingMode(mode);
  };

  // don't set colors on slices
  publicAPI.setColorBy = () => {};
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

  vtkRepresentationProxyTransformMixin(vtkImageTransformFilter)(
    publicAPI,
    model
  );

  // Object specific methods
  vtkTransformedSliceRepresentationProxy(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkTransformedSliceRepresentationProxy'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
