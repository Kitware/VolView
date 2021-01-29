import macro from 'vtk.js/Sources/macro';
import vtkBaseView2DProxy from 'vtk.js/Sources/Proxy/Core/View2DProxy';

import { commonViewCustomizations } from '@/src/vtk/View3DProxy';

function vtkView2DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkMedicalView2DProxy');
  commonViewCustomizations(publicAPI, model);

  // we will set the manipulator ourselves
  publicAPI.bindRepresentationToManipulator = () => {};
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkBaseView2DProxy.extend(publicAPI, model, initialValues);

  vtkView2DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkMedicalView2DProxy');

export default { newInstance, extend };
