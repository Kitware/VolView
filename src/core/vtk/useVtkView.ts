import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { View } from '@/src/core/vtk/types';
import { Maybe } from '@/src/types';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { useElementSize } from '@vueuse/core';
import {
  MaybeRef,
  onScopeDispose,
  unref,
  watchEffect,
  watchPostEffect,
} from 'vue';

export function useWebGLRenderWindow(container: MaybeRef<Maybe<HTMLElement>>) {
  const renderWindowView = vtkOpenGLRenderWindow.newInstance();

  watchPostEffect((onCleanup) => {
    const el = unref(container);
    if (!el) return;

    renderWindowView.setContainer(el);
    onCleanup(() => {
      renderWindowView.setContainer(null as unknown as HTMLElement);
    });
  });

  onScopeDispose(() => {
    renderWindowView.delete();
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
  const renderer = vtkRenderer.newInstance();
  const renderWindow = vtkRenderWindow.newInstance();
  renderWindow.addRenderer(renderer);

  // the render window view
  const renderWindowView = useWebGLRenderWindow(container);
  renderWindow.addView(renderWindowView);

  onScopeDispose(() => {
    renderWindow.removeView(renderWindowView);
  });

  // interactor
  const interactor = vtkRenderWindowInteractor.newInstance();
  renderWindow.setInteractor(interactor);
  interactor.setView(renderWindowView);

  watchPostEffect((onCleanup) => {
    const el = unref(container);
    if (!el) return;

    interactor.initialize();
    interactor.bindEvents(el);
    onCleanup(() => {
      if (interactor.getContainer()) interactor.unbindEvents();
    });
  });

  // widget manager
  const widgetManager = useWidgetManager(renderer);

  // render API
  const deferredRender = batchForNextTask(() => {
    // don't need to re-render during animation
    if (interactor.isAnimating()) return;
    widgetManager.renderWidgets();
    renderWindow.render();
  });

  const immediateRender = () => {
    if (interactor.isAnimating()) return;
    renderWindow.render();
  };

  const requestRender = ({ immediate } = { immediate: true }) => {
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
    requestRender({ immediate: true });
  };

  const { width, height } = useElementSize(container);
  watchEffect(() => {
    setSize(width.value, height.value);
  });

  // cleanup
  onScopeDispose(() => {
    renderWindow.removeRenderer(renderer);

    renderer.delete();
    renderWindow.delete();
    interactor.delete();
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
