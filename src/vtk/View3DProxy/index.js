import macro from '@kitware/vtk.js/macro';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

export function commonViewCustomizations(publicAPI, model) {
  const delayedRender = macro.debounce(model.renderWindow.render, 5);

  // override resize to avoid flickering from rendering later
  publicAPI.resize = () => {
    if (model.container) {
      const dims = model.container.getBoundingClientRect();
      if (dims.width === dims.height && dims.width === 0) {
        return;
      }
      const devicePixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(10, Math.floor(devicePixelRatio * dims.width));
      const height = Math.max(10, Math.floor(devicePixelRatio * dims.height));
      model.openglRenderWindow.setSize(width, height);
      publicAPI.invokeResize({ width, height });
      publicAPI.render(true);
    }
  };

  // override render to not reset camera
  publicAPI.render = (blocking = true) => {
    model.orientationWidget.updateMarkerOrientation();
    if (blocking) {
      model.renderWindow.render();
    } else {
      delayedRender();
    }
  };

  // add helper function
  publicAPI.removeAllRepresentations = () => {
    model.representations.forEach((rep) => model.renderer.removeViewProp(rep));
    model.representations.length = 0;
  };
}

function vtkCustomView3DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkCustomView3DProxy');
  commonViewCustomizations(publicAPI, model);
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkViewProxy.extend(publicAPI, model, initialValues);

  vtkCustomView3DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkCustomView3DProxy');

export default { newInstance, extend };
