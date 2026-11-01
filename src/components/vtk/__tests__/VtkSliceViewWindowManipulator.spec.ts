import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import { defineComponent, h, nextTick, onUnmounted, provide, ref } from 'vue';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import type vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import type vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import { VtkViewContext } from '@/src/components/vtk/context';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import { useViewWindowingRanges } from '@/src/composables/useViewWindowingRanges';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import type { VtkViewApi } from '@/src/types/vtk-types';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';

enableAutoUnmount(afterEach);
beforeEach(() => setActivePinia(createPinia()));

function create(derived: boolean) {
  const store = useWindowingStore();
  useImageStatsStore().stats.image = {
    scalarMin: 10,
    scalarMax: 20,
    autoRangeValues: { FullRange: [10, 20] },
  };
  const ranges = ref({
    FullRange: [1000, 2000] as [number, number],
    LowContrast: [1010, 1990] as [number, number],
    MediumContrast: [1020, 1980] as [number, number],
    HighContrast: [1050, 1950] as [number, number],
  });
  const style = vtkInteractorStyleManipulator.newInstance();
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(VtkViewContext, {
          interactorStyle: style,
        } as unknown as VtkViewApi);
        if (derived) useViewWindowingRanges('view', 'image', ranges);
        onUnmounted(() => style.delete());
        return () =>
          h('div', [
            h(VtkSliceViewWindowManipulator, {
              viewId: 'view',
              imageId: 'image',
            }),
            h(
              'div',
              { 'data-testid': 'window' },
              h(WindowLevelControls, { viewId: 'view', imageId: 'image' })
            ),
            h(
              'div',
              { 'data-testid': 'source-window' },
              h(WindowLevelControls, { viewId: 'raw', imageId: 'image' })
            ),
          ]);
      },
    }),
    { global: { plugins: [createVuetify()] } }
  );
  const displayed = (id = 'window') => {
    const controls = wrapper.get(`[data-testid="${id}"]`);
    const [width, level] = controls.findAll<HTMLInputElement>(
      'input[type="number"]'
    );
    return {
      width: Number(width.element.value),
      level: Number(level.element.value),
      useAuto: controls
        .findAll<HTMLInputElement>('input[type="radio"]')
        .some((radio) => radio.element.checked),
    };
  };
  const drag = (x: number, y: number) => {
    const manipulator =
      style.getMouseManipulators()[0] as vtkMouseRangeManipulator;
    const renderer = vtkRenderer.newInstance();
    const interactor = {
      getView: () => ({
        getContainerSize: () => [100, 100],
        getSize: () => [100, 100],
        getViewportSize: () => [100, 100],
      }),
    } as unknown as vtkRenderWindowInteractor;
    manipulator.onButtonDown(interactor, renderer, { x: 0, y: 0 });
    manipulator.onMouseMove(interactor, renderer, { x, y });
    renderer.delete();
  };
  return { wrapper, store, ranges, displayed, drag };
}

describe('shared scalar window interaction', () => {
  it.each([false, true])(
    'keeps automatic windowing when mounted or updated programmatically (derived=%s)',
    async (derived) => {
      const { store, ranges, displayed } = create(derived);
      await nextTick();
      expect(displayed()).toMatchObject({
        useAuto: true,
      });
      if (derived) {
        ranges.value = {
          FullRange: [3000, 5000],
          LowContrast: [3010, 4990],
          MediumContrast: [3020, 4980],
          HighContrast: [3050, 4950],
        };
      } else {
        useImageStatsStore().stats.image.autoRangeValues = {
          FullRange: [30, 50],
        };
      }
      await nextTick();
      expect(displayed()).toMatchObject({
        width: derived ? 1980 : 20,
        level: derived ? 4000 : 40,
        useAuto: true,
      });
      store.updateConfig('view', 'image', {
        width: 40,
        level: 15,
        useAuto: false,
      });
      await nextTick();
      expect(displayed()).toMatchObject({
        width: 40,
        level: 15,
        useAuto: false,
      });
    }
  );

  it('uses the derived scalar range for a real drag and keeps source contrast independent', async () => {
    const { drag, displayed } = create(true);
    drag(50, 0);
    await nextTick();
    expect(displayed()).toMatchObject({
      useAuto: false,
      width: 980,
    });
    expect(displayed().level).toBeGreaterThan(1900);
    expect(displayed().level).toBeLessThan(2000);
    expect(displayed('source-window')).toMatchObject({
      width: 10,
      level: 15,
      useAuto: true,
    });
  });

  it.each([false, true])(
    'resets the displayed window through Reset Views (derived=%s)',
    async (derived) => {
      const { store, displayed } = create(derived);
      store.updateConfig('view', 'image', { width: 4, level: 12 }, true);
      await nextTick();
      expect(displayed()).toMatchObject({
        width: 4,
        level: 12,
        useAuto: false,
      });
      const reset = mount(ResetViews, {
        global: { plugins: [createVuetify()] },
      });
      await reset.get('button').trigger('click');
      expect(displayed()).toMatchObject({
        width: derived ? 980 : 10,
        level: derived ? 1500 : 15,
        useAuto: true,
      });
    }
  );
});
