import macro from '@kitware/vtk.js/macro';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { applyLPSViewProxyBase } from '@/src/vtk/LPSViewProxyBase';

function vtkLPSView3DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkLPSView3DProxy');
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkViewProxy.extend(publicAPI, model, initialValues);
  applyLPSViewProxyBase(publicAPI, model);

  vtkLPSView3DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkLPSView3DProxy');

export default { newInstance, extend };
