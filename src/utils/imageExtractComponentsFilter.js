/* eslint-disable no-param-reassign */
import macro from '@kitware/vtk.js/macro';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

function vtkImageExtractComponentsFilter(publicAPI, model) {
  model.classHierarchy.push('vtkImageExtractComponentsFilter');

  publicAPI.requestData = (inData, outData) => {
    const inputData = inData[0];
    const outputData = vtkImageData.newInstance();

    const components = model.components;
    if (!components || !Array.isArray(components) || components.length === 0) {
      throw Error('No components specified for extraction.');
    }

    const inputScalars = inputData.getPointData().getScalars();
    const numInputComponents = inputScalars.getNumberOfComponents();
    components.forEach((c) => {
      if (c < 0) {
        throw Error('Component index must be greater than or equal to 0.');
      }
      if (c >= numInputComponents) {
        throw Error(
          'Component index must be less than the number of components in the input data.'
        );
      }
    });

    outputData.shallowCopy(inputData);

    const inputArray = inputScalars.getData();
    const numPixels = inputArray.length / numInputComponents;

    const outputNumComponents = components.length;
    const outputArray = new inputArray.constructor(
      numPixels * outputNumComponents
    );

    for (let pixel = 0; pixel < numPixels; pixel++) {
      for (let c = 0; c < components.length; c++) {
        outputArray[pixel * outputNumComponents + c] =
          inputArray[pixel * numInputComponents + components[c]];
      }
    }

    outputData.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: outputNumComponents,
        values: outputArray,
      })
    );

    outData[0] = outputData;
  };
}

const DEFAULT_VALUES = {
  components: [],
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  macro.obj(publicAPI, model);

  macro.algo(publicAPI, model, 1, 1);

  macro.setGet(publicAPI, model, ['components']);

  vtkImageExtractComponentsFilter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkImageExtractComponentsFilter'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };
