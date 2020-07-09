import macro from 'vtk.js/Sources/macro';
import { mat4 } from 'gl-matrix';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { transformImage } from '@/src/vtk/ImageTransformFilter';

const { vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// vtkLabelMapTransformFilter methods
// ----------------------------------------------------------------------------

function vtkLabelMapTransformFilter(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkLabelMapTransformFilter');

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

    const out = transformImage(input, model.transform, {
      imageClass: vtkLabelMap,
      propsToCopy: ['extent', 'spacing', 'colorMap'],
    });

    outData[0] = out;
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
  vtkLabelMapTransformFilter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkLabelMapTransformFilter'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
