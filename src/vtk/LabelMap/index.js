import macro from '@kitware/vtk.js/macro';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  vtkImageData.extend(publicAPI, model, initialValues);
  model.classHierarchy.push('vtkLabelMap');

  let modifiedExtent = null;
  const modified = publicAPI.modified;
  publicAPI.modified = (otherMTime) => {
    modifiedExtent = null;
    modified(otherMTime);
  };
  publicAPI.modifiedWithin = (extent) => {
    modifiedExtent = [...extent];
    modified();
  };
  publicAPI.getModifiedExtent = () => modifiedExtent;
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkLabelMap');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
