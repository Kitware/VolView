import macro from 'vtk.js/Sources/macro';
import vtkCutter from 'vtk.js/Sources/Filters/Core/Cutter';

function vtkCachedCutter(publicAPI, model) {
  model.classHierarchy.push('vtkCachedCutter');

  const superClass = { ...publicAPI };
  const cache = new Map();

  function computeTag(polydata) {
    const cutFuncState = JSON.stringify(model.cutFunction.getState());
    const mtime = polydata.getMTime();
    return `${mtime}::${cutFuncState}`;
  }

  publicAPI.clearCache = () => {
    cache.clear();
  };

  publicAPI.computeSlice = (polyData) => {
    const tag = computeTag(polyData);
    if (cache.has(tag)) {
      return cache.get(tag);
    }
    const outData = [];
    superClass.requestData([polyData], outData);
    cache.set(tag, outData[0]);
    return outData[0];
  };

  publicAPI.requestData = (inData, outData) => {
    outData[0] = publicAPI.computeSlice(inData[0]);
    outData[0].modified();
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
