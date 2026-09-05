import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { View } from '@/src/core/vtk/types';
import { Maybe } from '@/src/types';
import { VtkRenderWindowParentApi } from '@/src/types/vtk-types';
import { releaseOpenGLRenderWindow } from '@/src/core/vtk/releaseRenderWindow';
import { releaseWidgetManager } from '@/src/core/vtk/releaseWidgetManager';
import { deleteInteractor } from '@/src/core/vtk/deleteInteractor';
import { NOOP } from '@/src/constants';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { useElementSize } from '@vueuse/core';
import {
  inject,
  MaybeRef,
  onScopeDispose,
  unref,
  watchEffect,
  watchPostEffect,
} from 'vue';

export function useWebGLRenderWindow(
  renderWindow: vtkRenderWindow,
  container: MaybeRef<Maybe<HTMLElement>>,
  parent: Maybe<VtkRenderWindowParentApi>
) {
  const renderWindowView =
    (parent?.renderWindowView.addMissingNode(renderWindow) as
      | vtkOpenGLRenderWindow
      | undefined) ?? vtkOpenGLRenderWindow.newInstance();

  watchPostEffect((onCleanup) => {
    const el = unref(container);
    if (!el) return;

    renderWindowView.setContainer(el);
    onCleanup(() => {
      renderWindowView.setContainer(null as unknown as HTMLElement);
    });
  });

  onScopeDispose(() => {
    // a child node draws through its parent's context, so only the standalone
    // case has one of its own to release
    if (parent?.renderWindowView) {
      parent.renderWindowView.removeNode(renderWindowView);
    } else {
      releaseOpenGLRenderWindow(renderWindowView);
    }
  });

  renderWindow.addView(renderWindowView);

  onScopeDispose(() => {
    renderWindow.removeView(renderWindowView);
  });

  return renderWindowView;
}

export function useWidgetManager(renderer: vtkRenderer) {
  const manager = vtkWidgetManager.newInstance();
  manager.setRenderer(renderer);

  const updatePickingState = () => {
    const enabled = manager.getPickingEnabled();
    const widgetCount = manager.getWidgets().length;
    if (!enabled && widgetCount) {
      manager.enablePicking();
    } else if (enabled && !widgetCount) {
      manager.disablePicking();
    }
  };

  onVTKEvent(manager, 'onModified', updatePickingState);
  updatePickingState();

  return manager;
}

export function useVtkView(container: MaybeRef<Maybe<HTMLElement>>): View {
  const parent = inject(VtkRenderWindowParentContext, null);
  const renderer = vtkRenderer.newInstance();
  const renderWindow = vtkRenderWindow.newInstance();
  renderWindow.addRenderer(renderer);

  let disposed = false;
  let releaseWidgets = NOOP;

  // registered first so it runs before the teardown below: picking resources go
  // back through the root view, and the parent rebuilds its scene graph from
  // its own child render window list
  onScopeDispose(() => {
    disposed = true;
    releaseWidgets();
    parent?.renderWindow.removeRenderWindow(renderWindow);
  });

  parent?.renderWindow.addRenderWindow(renderWindow);

  // the render window view
  const renderWindowView = useWebGLRenderWindow(
    renderWindow,
    container,
    parent
  );

  // interactor
  const interactor = vtkRenderWindowInteractor.newInstance();
  renderWindow.setInteractor(interactor);
  interactor.setView(renderWindowView);

  watchPostEffect((onCleanup) => {
    const el = unref(container);
    if (!el) return;

    interactor.initialize();
    interactor.setContainer(el);
    onCleanup(() => {
      if (interactor.getContainer()) interactor.unbindEvents();
    });
  });

  // widget manager
  const widgetManager = useWidgetManager(renderer);
  releaseWidgets = () =>
    releaseWidgetManager(
      widgetManager,
      parent?.renderWindowView ?? renderWindowView
    );

  // render API
  const deferredRender = batchForNextTask(() => {
    // don't need to re-render during animation
    if (interactor.isAnimating()) return;
    widgetManager.renderWidgets();
    renderWindow.render();
  });

  const immediateRender = () => {
    if (interactor.isAnimating()) return;
    parent?.renderWindow.render();
    renderWindow.render();
  };

  // requests outlive the view: vtk event handlers and promises that settle
  // after dispose has deleted the scene graph nodes a render would traverse
  const requestRender = ({ immediate } = { immediate: false }) => {
    if (disposed) return;
    if (immediate) {
      immediateRender();
    }
    deferredRender();
  };

  onVTKEvent(renderer, 'onModified', () => {
    requestRender();
  });

  // set size
  const setSize = (width: number, height: number) => {
    // ensure we have a non-zero size, otherwise
    // the framebuffers might not be populated correctly
    const scaledWidth = Math.max(1, width * globalThis.devicePixelRatio);
    const scaledHeight = Math.max(1, height * globalThis.devicePixelRatio);
    renderWindowView.setSize(scaledWidth, scaledHeight);
    renderer.resetCameraClippingRange();

    parent?.renderWindowView.resizeFromChildRenderWindows();
    parent?.renderWindow.render();
    requestRender({ immediate: true });
  };

  const { width, height } = useElementSize(container);
  watchEffect(() => {
    setSize(width.value, height.value);
  });

  // cleanup
  onScopeDispose(() => {
    deferredRender.cancel();

    renderWindow.removeRenderer(renderer);

    renderer.delete();
    renderWindow.delete();
    deleteInteractor(interactor);
  });

  return {
    renderer,
    renderWindow,
    interactor,
    renderWindowView,
    widgetManager,
    requestRender,
  };
}
