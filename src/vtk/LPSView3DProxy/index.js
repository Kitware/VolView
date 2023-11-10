import { vec3 } from 'gl-matrix';
import macro from '@kitware/vtk.js/macro';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkOffscreenRenderWindowInteractor from '@/src/vtk/vtkOffscreenRenderWindowInteractor';

export function replaceInteractor(publicAPI, model) {
  // prep to remove the old interactor
  const style = model.interactor.getInteractorStyle();
  const orientationWidgetEnabled = model.orientationWidget.getEnabled();
  model.orientationWidget.setEnabled(false);

  // delete the old interactor in favor of the new one
  model.interactor.delete();

  model.interactor = vtkOffscreenRenderWindowInteractor.newInstance();
  model.interactor.setView(model._openGLRenderWindow);
  model.interactor.setInteractorStyle(style);
  model.orientationWidget.setInteractor(model.interactor);
  model.orientationWidget.setEnabled(orientationWidgetEnabled);
}

export function commonViewCustomizations(publicAPI, model) {
  const delayedRender = macro.debounce(model.renderWindow.render, 5);

  replaceInteractor(publicAPI, model);

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
      model.renderWindow.getViews()[0].setSize(width, height);
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

  // provide a renderLater impl that schedules for the next js task
  let timeout = null;
  publicAPI.renderLater = () => {
    if (timeout != null) return;
    timeout = setTimeout(() => {
      publicAPI.render();
      timeout = null;
    }, 0);
  };

  // add helper function
  publicAPI.removeAllRepresentations = () => {
    model.representations.forEach((rep) => model.renderer.removeViewProp(rep));
    model.representations.length = 0;
  };

  publicAPI.updateCamera = (directionOfProjection, viewUp, focalPoint) => {
    const position = vec3.clone(focalPoint);
    vec3.sub(position, position, directionOfProjection);
    model.camera.setFocalPoint(...focalPoint);
    model.camera.setPosition(...position);
    model.camera.setDirectionOfProjection(...directionOfProjection);
    model.camera.setViewUp(...viewUp);
  };

  // disable the built-in corner annotations
  const { setContainer } = publicAPI;
  publicAPI.setContainer = (el) => {
    setContainer(el);
    model.cornerAnnotation.setContainer(null);
  };

  const { resetCamera } = publicAPI;
  publicAPI.resetCamera = (...args) => {
    resetCamera(args);
    model.renderer.updateLightsGeometryToFollowCamera();
  };

  publicAPI.setSize = (width, height) => {
    const container = publicAPI.getContainer();
    if (!container) throw new Error('No container');
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    publicAPI.resize();
  };

  publicAPI.setInteractionContainer = (el) => {
    return model.interactor.setInteractionContainer(el);
  };

  publicAPI.getInteractionContainer = () => {
    return model.interactor.getInteractionContainer();
  };

  // initialize

  const container = document.createElement('div');
  container.style.display = 'block';
  container.style.visibility = 'hidden';
  container.style.position = 'absolute';
  document.body.appendChild(container);
  publicAPI.setContainer(container);
}

function vtkLPSView3DProxy(publicAPI, model) {
  model.classHierarchy.push('vtkLPSView3DProxy');
  commonViewCustomizations(publicAPI, model);
}

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, initialValues);

  vtkViewProxy.extend(publicAPI, model, initialValues);

  vtkLPSView3DProxy(publicAPI, model);
}

export const newInstance = macro.newInstance(extend, 'vtkLPSView3DProxy');

export default { newInstance, extend };
