import macro from 'vtk.js/Sources/macro';
import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';
import { mat4 } from 'gl-matrix';

const { vtkErrorMacro } = macro;

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

    const outImage = vtkImageData.newInstance(input.get('extent', 'spacing'));
    outImage.getPointData().setScalars(input.getPointData().getScalars());

    const transformed = mat4.create();
    const original = input.getIndexToWorld();
    mat4.multiply(transformed, model.transform, original);

    outImage.setOrigin(transformed[12], transformed[13], transformed[14]);
    outImage.setDirection(
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
      transformed[10],
    );

    outData[0] = outImage;
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
