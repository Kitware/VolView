import macro from '@kitware/vtk.js/macro';
import vtkBaseView2DProxy from '@kitware/vtk.js/Proxy/Core/View2DProxy';

import { commonViewCustomizations } from '@/src/vtk/View3DProxy';

function vtkView2DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkMedicalView2DProxy');
  commonViewCustomizations(publicAPI, model);

  // we will set the manipulator ourselves
  publicAPI.bindRepresentationToManipulator = () => {};

  // allow setting the axis
  publicAPI.setAxis = (axis) => {
    if (axis !== model.axis) {
      model.axis = axis;
      model.representations
        .filter((rep) => !!rep.setSlicingMode)
        .forEach((rep) => rep.setSlicingMode('XYZ'[axis]));
      return true;
    }
    return false;
  };
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkBaseView2DProxy.extend(publicAPI, model, initialValues);

  vtkView2DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkMedicalView2DProxy');

export default { newInstance, extend };
