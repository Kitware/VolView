import macro from '@kitware/vtk.js/macro';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { mat4 } from 'gl-matrix';

const { vtkErrorMacro } = macro;

export function transformImage(
  imageData,
  transform,
  options = {
    imageClass: vtkImageData,
    propsToCopy: ['extent', 'spacing'],
  }
) {
  const { imageClass, propsToCopy } = options;
  const clone = imageClass.newInstance(imageData.get(...propsToCopy));
  clone.getPointData().setScalars(imageData.getPointData().getScalars());

  const transformed = mat4.create();
  const original = imageData.getIndexToWorld();
  mat4.multiply(transformed, transform, original);

  clone.setOrigin(transformed[12], transformed[13], transformed[14]);
  clone.setDirection(
    // I axis
    transformed[0],
    transformed[1],
    transformed[2],
    // J axis
    transformed[4],
    transformed[5],
    transformed[6],
    // K axis
    transformed[8],
    transformed[9],
    transformed[10]
  );

  return clone;
}

// ----------------------------------------------------------------------------
// vtkImageTransformFilter methods
// ----------------------------------------------------------------------------

function vtkImageTransformFilter(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkImageTransformFilter');

  // --------------------------------------------------------------------------

  publicAPI.requestData = (inData, outData) => {
    // implement requestData
    const input = inData[0];

    if (!input) {
      return;
    }

    const scalars = input.getPointData().getScalars();

    if (!scalars) {
      vtkErrorMacro('No scalars from input');
      return;
    }

    outData[0] = transformImage(input, model.transform);
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  transform: mat4.create(),
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Make this a VTK object
  macro.obj(publicAPI, model);

  // Also make it an algorithm with one input and one output
  macro.algo(publicAPI, model, 1, 1);

  macro.setGetArray(publicAPI, model, ['transform'], 16);

  // Object specific methods
  vtkImageTransformFilter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkImageTransformFilter');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
