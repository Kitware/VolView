import macro from 'vtk.js/Sources/macro';
import vtkCutter from 'vtk.js/Sources/Filters/Core/Cutter';

function vtkCachedCutter(publicAPI, model) {
  model.classHierarchy.push('vtkCachedCutter');

  const superClass = { ...publicAPI };
  const cache = new Map();

  publicAPI.requestData = (inData, outData) => {
    const tag = JSON.stringify(model.cutFunction.getState());
    if (cache.has(tag)) {
      outData[0] = cache.get(tag);
      outData[0].modified();
    } else {
      superClass.requestData(inData, outData);
      cache.set(tag, outData[0]);
    }
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
  vtkCutter.extend(publicAPI, model);

  // Object specific methods
  vtkCachedCutter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkCachedCutter');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
