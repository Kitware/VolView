import { vec3 } from 'gl-matrix';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { CaptureOn } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';

export function applyLPSViewProxyBase(publicAPI, model) {
  model._widgetManager = vtkWidgetManager.newInstance({
    pickingEnabled: true,
    captureOn: CaptureOn.MOUSE_MOVE,
  });
  model._widgetManager.setRenderer(model.renderer);

  publicAPI.getWidgetManager = () => model._widgetManager;

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
      publicAPI.render();
    }
  };

  // override render to not reset camera and to not render during animation
  publicAPI.render = () => {
    if (model.interactor.isAnimating()) return;
    model.orientationWidget.updateMarkerOrientation();
    model.renderWindow.render();
  };

  // provide a renderLater impl that schedules for the next js task
  publicAPI.renderLater = batchForNextTask(() => {
    publicAPI.render();
  });

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

  const { setContainer } = publicAPI;
  publicAPI.setContainer = (el) => {
    const changed = model.container !== el;
    setContainer(el);
    // disable the built-in corner annotations
    model.cornerAnnotation.setContainer(null);
    // trigger onModified
    if (changed) publicAPI.modified();
  };

  const { resetCamera } = publicAPI;
  publicAPI.resetCamera = (...args) => {
    resetCamera(args);
    model.renderer.updateLightsGeometryToFollowCamera();
  };

  const { delete: delete_ } = publicAPI;
  publicAPI.delete = () => {
    delete_();
    model._widgetManager.delete();
  };
}
