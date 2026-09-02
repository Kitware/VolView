import macro from '@kitware/vtk.js/macro';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import deepEqual from 'deep-equal';

// ----------------------------------------------------------------------------
// vtkLabelMap methods
// ----------------------------------------------------------------------------

function vtkLabelMap(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkLabelMap');

  const originalAPI = { ...publicAPI };

  publicAPI.setSegments = (segments) => {
    if (segments === model.segments || deepEqual(segments, model.segments)) {
      return false;
    }
    return originalAPI.setSegments(segments);
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const defaultValues = () => ({
  segments: [],
});

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, defaultValues(), initialValues);

  vtkImageData.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, ['segments']);

  // Object specific methods
  vtkLabelMap(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkLabelMap');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
