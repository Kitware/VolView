import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { VtkRenderWindowParentApi } from '@/src/types/vtk-types';
import { View } from '@/src/core/vtk/types';
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

// Each render draws the view's widgets first, which modifies the widget manager.
function countRenders(view: View, duringRender = () => {}) {
  let count = 0;
  const sub = view.widgetManager.onModified(() => {
    count++;
    duringRender();
  });
  return { count: () => count, stop: () => sub?.unsubscribe() };
}

describe('useVtkView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['live', 'disposed', 'cleanup throws'] as const)(
    'only executes queued renders for a live view: %s',
    (state) => {
      const scope = effectScope(true);
      const view = scope.run(() => useVtkView(ref(null)))!;
      const renders = countRenders(view);

      try {
        view.requestRender();
        expect(vi.getTimerCount()).toBe(1);

        if (state === 'cleanup throws') {
          const error = new Error('view removal listener failed');
          // removeView emits Modified after the OpenGL view has been deleted,
          // but before disposal reaches deferredRender.cancel().
          const failure = view.renderWindow.onModified(() => {
            if (!view.renderWindow.hasView(view.renderWindowView)) throw error;
          });
          try {
            expect(() => scope.stop()).toThrow(error);
          } finally {
            failure?.unsubscribe();
          }
          expect(view.renderWindowView.isDeleted()).toBe(true);
          expect(view.renderWindow.hasView(view.renderWindowView)).toBe(false);
          // Cleanup stopped before reaching deferredRender.cancel().
          expect(vi.getTimerCount()).toBe(1);
        } else if (state === 'disposed') {
          scope.stop();
          expect(vi.getTimerCount()).toBe(0);
        }

        vi.runAllTimers();

        expect(renders.count()).toBe(state === 'live' ? 1 : 0);
      } finally {
        renders.stop();
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

  it('renders once per frame, however many renders vtk and the app ask for', () => {
    const scope = effectScope(true);
    const view = scope.run(() => useVtkView(ref(null)))!;
    const renders = countRenders(view);

    try {
      view.requestRender();
      view.renderWindow.render();
      view.interactor.render();
      expect(renders.count()).toBe(0);

      vi.runAllTimers();

      expect(renders.count()).toBe(1);
    } finally {
      scope.stop();
    }
  });

  it('does not render again for a request made while rendering', () => {
    const scope = effectScope(true);
    const view = scope.run(() => useVtkView(ref(null)))!;
    const renders = countRenders(view, () => view.requestRender());

    try {
      view.requestRender();
      vi.runAllTimers();

      expect(renders.count()).toBe(1);
    } finally {
      scope.stop();
    }
  });

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
