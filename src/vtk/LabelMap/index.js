import macro from '@kitware/vtk.js/macro';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

const { vtkWarningMacro } = macro;

// ----------------------------------------------------------------------------
// vtkLabelMap methods
// ----------------------------------------------------------------------------

function vtkLabelMap(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkLabelMap');

  // color is RGB, with optional A. Values in [0, 255].
  publicAPI.setLabelColor = (label, color) => {
    if (Number.isNaN(Number(label))) {
      vtkWarningMacro('Provided label is not a number');
    } else {
      model.colorMap[label] = color.slice();
      if (model.colorMap[label][3] === undefined) {
        model.colorMap[label][3] = 255;
      }
      publicAPI.modified();
    }
  };

  publicAPI.removeLabel = (label) => {
    if (Number.isNaN(Number(label))) {
      vtkWarningMacro('Provided label is not a number');
    } else {
      delete model.colorMap[label];
      publicAPI.modified();
    }
  };

  if (model.colorMap === null) {
    // default colormap
    model.colorMap = {
      0: [0, 0, 0, 0],
      1: [0, 0, 0, 255],
    };
  }
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  // default opacity map uses 0 as the transparent pixel
  colorMap: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  vtkImageData.extend(publicAPI, model, initialValues);

  macro.setGet(publicAPI, model, ['colorMap']);

  // Object specific methods
  vtkLabelMap(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkLabelMap');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
