import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { VtkRenderWindowParentApi } from '@/src/types/vtk-types';
import { useVtkView, useWebGLRenderWindow } from '@/src/core/vtk/useVtkView';

function createParent() {
  const renderWindow = vtkRenderWindow.newInstance();
  const renderWindowView = renderWindow.newAPISpecificView(
    'WebGL'
  ) as vtkOpenGLRenderWindow;
  renderWindow.addView(renderWindowView);
  return { renderWindow, renderWindowView, contextLost: ref(false) };
}

function createRecordingParent(calls: Array<string>) {
  const { renderWindow, renderWindowView, contextLost } = createParent();
  // an uninitialized interactor keeps the parent's renders inert: the test DOM
  // has no WebGL context to traverse
  renderWindow.setInteractor(vtkRenderWindowInteractor.newInstance());

  return {
    contextLost,
    renderWindow: {
      ...renderWindow,
      removeRenderWindow: (child: vtkRenderWindow) => {
        calls.push('removeRenderWindow');
        return renderWindow.removeRenderWindow(child);
      },
    },
    renderWindowView: {
      ...renderWindowView,
      removeNode: (node: vtkOpenGLRenderWindow) => {
        calls.push('removeNode');
        return renderWindowView.removeNode(node);
      },
    },
  } as unknown as VtkRenderWindowParentApi;
}

function mountViewUnder(parent: VtkRenderWindowParentApi) {
  const component = defineComponent({
    setup() {
      // no container: attaching one kicks off renders the test DOM cannot
      // service without a WebGL context
      useVtkView(ref(null));
      return () => h('div');
    },
  });
  return mount(component, {
    global: {
      provide: { [VtkRenderWindowParentContext as symbol]: parent },
    },
  });
}

describe('useVtkView teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // newInstance freezes the API. Use the same implementation without freezing
    // it so the tests can observe renders and inject a cleanup failure.
    vi.spyOn(vtkRenderWindow, 'newInstance').mockImplementation(() => {
      const api = {} as vtkRenderWindow;
      vtkRenderWindow.extend(api, {});
      return api;
    });
    vi.spyOn(vtkWidgetManager, 'newInstance').mockImplementation(() => {
      const api = {} as vtkWidgetManager;
      vtkWidgetManager.extend(api, {});
      return api;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['live', 'disposed', 'cleanup throws'] as const)(
    'only executes queued renders for a live view: %s',
    (state) => {
      const scope = effectScope(true);
      const view = scope.run(() => useVtkView(ref(null)))!;
      // Observe render dispatch without needing a WebGL context in the test DOM.
      const render = vi
        .spyOn(view.renderWindow, 'render')
        .mockImplementation(() => {});
      const renderWidgets = vi
        .spyOn(view.widgetManager, 'renderWidgets')
        .mockImplementation(() => {});

      try {
        view.requestRender();
        expect(vi.getTimerCount()).toBe(1);

        if (state === 'cleanup throws') {
          const error = new Error('selector cleanup failed');
          vi.spyOn(view.widgetManager, 'delete').mockImplementationOnce(() => {
            throw error;
          });
          expect(() => scope.stop()).toThrow(error);
          expect(view.renderWindowView.isDeleted()).toBe(true);
          // Cleanup stopped before reaching deferredRender.cancel().
          expect(vi.getTimerCount()).toBe(1);
        } else if (state === 'disposed') {
          scope.stop();
          expect(vi.getTimerCount()).toBe(0);
        }

        vi.runAllTimers();

        const expectedRenders = state === 'live' ? 1 : 0;
        expect(renderWidgets).toHaveBeenCalledTimes(expectedRenders);
        expect(render).toHaveBeenCalledTimes(expectedRenders);
      } finally {
        scope.stop();
        // A throwing scope cleanup does not resume on a second stop().
        [
          view.widgetManager,
          view.renderer,
          view.renderWindow,
          view.interactor,
        ].forEach((object) => {
          if (!object.isDeleted()) object.delete();
        });
      }
    }
  );

  it('queues no render work once the view scope is disposed', () => {
    const container = document.createElement('div');
    const scope = effectScope(true);
    const view = scope.run(() => useVtkView(container))!;

    scope.stop();

    view.requestRender();
    view.requestRender({ immediate: true });

    expect(vi.getTimerCount()).toBe(0);
    expect(view.widgetManager.isDeleted()).toBe(true);
  });

  it('takes its view node off the parent scene graph on dispose', () => {
    const parent = createParent();
    const renderWindow = vtkRenderWindow.newInstance();
    const container = document.createElement('div');
    const scope = effectScope(true);

    const renderWindowView = scope.run(() =>
      useWebGLRenderWindow(renderWindow, container, parent)
    )!;
    expect(parent.renderWindowView.getChildren()).toHaveLength(1);

    scope.stop();

    expect(parent.renderWindowView.getChildren()).toHaveLength(0);
    expect(renderWindowView.isDeleted()).toBe(true);
  });

  it('unregisters from the parent render window before dropping its view node', () => {
    const calls: Array<string> = [];
    const wrapper = mountViewUnder(createRecordingParent(calls));

    wrapper.unmount();

    expect(calls).toEqual(['removeRenderWindow', 'removeNode']);
  });
});
