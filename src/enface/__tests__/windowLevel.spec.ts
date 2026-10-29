import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import {
  computed,
  defineComponent,
  effectScope,
  h,
  nextTick,
  onScopeDispose,
  ref,
} from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewStore } from '@/src/store/views';
import { useViewWindowingRanges } from '@/src/composables/useViewWindowingRanges';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { slabWindowRanges } from '@/src/core/slab/windowRanges';
import type { SlabSpecification } from '@/src/core/slab/types';
import { WLAutoRanges } from '@/src/constants';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import type { VtkViewApi } from '@/src/types/vtk-types';

enableAutoUnmount(afterEach);
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function rangesFor(
  values: ArrayLike<number>,
  dimensions: [number, number, number] = [values.length, 1, 1],
  specification: SlabSpecification = {
    axis: 1,
    first: 0,
    last: 0,
    method: 'mean',
  }
) {
  if (!values.length) return null;
  const image = vtkImageData.newInstance();
  image.setDimensions(dimensions);
  const scalars = vtkDataArray.newInstance({
    values: Float64Array.from(values),
    numberOfComponents: 1,
  });
  image.getPointData().setScalars(scalars);
  try {
    return slabWindowRanges(image, specification);
  } finally {
    image.delete();
    scalars.delete();
  }
}

function create(
  values = ref<ArrayLike<number> | null>(
    Float32Array.from([0, 25, 50, 75, 100])
  ),
  viewId = ref('view'),
  imageId = ref<string | null>('image')
) {
  const scope = effectScope();
  scopes.push(scope);
  const ranges = computed(() =>
    values.value ? rangesFor(values.value) : null
  );
  const config = scope.run(() => {
    const current = useViewWindowingRanges(viewId, imageId, ranges);
    const interactorStyle = vtkInteractorStyleManipulator.newInstance();
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(VtkSliceViewWindowManipulator, {
            viewId: viewId.value,
            imageId: imageId.value,
          }),
      }),
      {
        global: {
          provide: {
            [VtkViewContext as symbol]: {
              interactorStyle,
            } as unknown as VtkViewApi,
          },
        },
      }
    );
    onScopeDispose(() => {
      wrapper.unmount();
      interactorStyle.delete();
    });
    return current;
  })!;
  return { config, scope, values, viewId, imageId, store: useWindowingStore() };
}

describe('En face windowing with normal view controls', () => {
  it('fits source Full Range and recalculates it when the reference distribution changes', async () => {
    const { config, values } = create();
    expect(config.value).toMatchObject({
      width: 100,
      level: 50,
      userTriggered: false,
      auto: 'FullRange',
      useAuto: true,
    });
    values.value = Float32Array.from([0, 250, 500, 750, 1000]);
    await nextTick();
    expect(config.value).toMatchObject({
      width: 1000,
      level: 500,
      useAuto: true,
    });
  });

  it.each([false, true])(
    'keeps manually restored contrast with userTriggered=%s across range changes',
    async (userTriggered) => {
      const store = useWindowingStore();
      store.deserialize('view', {
        image: {
          window: {
            preset: 'Grayscale',
            visibility: true,
            width: 25,
            level: 20,
            useAuto: false,
            auto: 'FullRange',
            userTriggered,
          },
        },
      });
      const { config, values } = create();
      expect(config.value).toMatchObject({
        width: 25,
        level: 20,
        useAuto: false,
      });
      values.value = Float32Array.from([0, 1000]);
      await nextTick();
      expect(config.value).toMatchObject({ width: 25, level: 20 });
      store.updateConfig('view', 'image', { width: 30, level: 24 }, true);
      expect(config.value).toMatchObject({ width: 30, level: 24 });
    }
  );

  it('preserves a selected percentile through range changes and a restored auto config', async () => {
    const values = ref<Float32Array | null>(
      Float32Array.from({ length: 1000 }, (_, index) => index)
    );
    const { config, store } = create(values);
    store.updateConfig('view', 'image', { auto: 'HighContrast' }, true);
    const firstWidth = config.value.width;
    expect(firstWidth).toBeLessThan(999);
    values.value = Float32Array.from(
      { length: 1000 },
      (_, index) => index * 10
    );
    await nextTick();
    expect(config.value).toMatchObject({ auto: 'HighContrast', useAuto: true });
    expect(config.value.width).toBeCloseTo(firstWidth * 10);
    store.deserialize('restored', {
      image: {
        window: {
          preset: 'Grayscale',
          visibility: true,
          auto: 'MediumContrast',
          useAuto: true,
          userTriggered: true,
        },
      },
    });
    const restored = create(values, ref('restored'));
    expect(restored.config.value).toMatchObject({
      auto: 'MediumContrast',
      useAuto: true,
    });
    expect(restored.config.value.width).toBeGreaterThan(config.value.width);
    expect(restored.config.value.width).toBeLessThan(9990);
  });

  it('resets through the real Reset Views action to source Full Range without recursive updates', async () => {
    const { config, store } = create();
    store.updateConfig('view', 'image', { auto: 'HighContrast' }, true);
    store.updateConfig('view', 'image', { width: 25, level: 20 }, true);
    let updates = 0;
    const listener = store.WindowingUpdateEvent.on(() => {
      updates += 1;
    });
    const reset = mount(ResetViews, {
      global: { plugins: [getActivePinia()!, createVuetify()] },
    });
    await reset.get('button').trigger('click');
    expect(updates).toBe(1);
    expect(config.value).toMatchObject({
      width: 100,
      level: 50,
      auto: 'FullRange',
      useAuto: true,
      userTriggered: false,
    });
    listener.off();
  });

  it('keeps raw source histogram and other view/image contrast independent', () => {
    const stats = useImageStatsStore();
    stats.stats.image = {
      scalarMin: 10,
      scalarMax: 20,
      autoRangeValues: { FullRange: [10, 20] },
    };
    const { config, store } = create();
    expect(store.getConfig('raw', 'image')).toMatchObject({
      width: 10,
      level: 15,
    });
    store.updateConfig('raw', 'image', { width: 4, level: 3 }, true);
    store.updateConfig('view', 'other-image', { width: 8, level: 5 }, true);
    expect(config.value).toMatchObject({ width: 100, level: 50 });
    expect(stats.stats.image.autoRangeValues).toEqual({ FullRange: [10, 20] });
  });

  it('keeps view and dataset choices while updating available projection ranges', async () => {
    const { config, store, viewId, imageId, values } = create();
    store.updateConfig('view', 'image', { auto: 'HighContrast' }, true);
    imageId.value = 'second-image';
    await nextTick();
    expect(store.getConfig('view', 'image')).toMatchObject({
      width: 100,
      level: 50,
      auto: 'HighContrast',
    });
    expect(config.value).toMatchObject({ width: 100, level: 50 });
    viewId.value = 'second-view';
    await nextTick();
    expect(store.getConfig('view', 'second-image').width).toBe(100);
    expect(config.value.width).toBe(100);
    values.value = null;
    await nextTick();
    expect(config.value.width).toBe(100);
    values.value = Float32Array.from([10, 30]);
    await nextTick();
    expect(config.value).toMatchObject({ width: 20, level: 20 });
  });

  it('removes reset listeners and range watchers when disposed', async () => {
    const { scope, values, store } = create();
    store.updateConfig('view', 'image', { width: 25, level: 20 }, true);
    scope.stop();
    const reset = mount(ResetViews, {
      global: { plugins: [getActivePinia()!, createVuetify()] },
    });
    await reset.get('button').trigger('click');
    expect(store.getConfig('view', 'image')).toMatchObject({
      width: 25,
      level: 20,
    });
    store.resetConfig('view', 'image');
    expect(store.getConfig('view', 'image').width).toBe(100);
    values.value = Float32Array.from([0, 1000]);
    await nextTick();
    expect(store.getConfig('view', 'image').width).toBe(100);
    store.removeData('image');
    expect(store.getConfig('view', 'image').width).toBe(1);
  });

  it('waits for a complete source before registering reference ranges', async () => {
    const values = ref<Float32Array | null>(null);
    const { config } = create(values);
    expect(config.value.width).toBe(1);
    values.value = Float32Array.from([5, 45]);
    await nextTick();
    expect(config.value).toMatchObject({ width: 40, level: 25 });
  });

  it('uses source ranges for all four shared Auto menu choices', async () => {
    const views = useViewStore();
    const view = views.layoutViews[0];
    views.setDataForView(view.id, 'image');
    views.setActiveView(view.id);
    const scalars = Float32Array.from(
      { length: 2000 },
      (_, index) => 300 + (index % 1000) / 2
    );
    useImageStatsStore().stats.image = {
      scalarMin: 300,
      scalarMax: 799.5,
      autoRangeValues: { FullRange: [300, 799.5], HighContrast: [325, 775] },
    };
    const { config, store } = create(ref(scalars), ref(view.id));
    store.updateConfig(view.id, 'image', { width: 40, level: 400 }, true);
    const controls = mount(WindowLevelControls, {
      attachTo: document.body,
      global: { plugins: [getActivePinia()!, createVuetify()] },
    });
    const widths: number[] = [];
    for (const key of Object.keys(WLAutoRanges)) {
      await controls.get(`input[value="${key}"]`).setValue(true);
      expect(config.value).toMatchObject({
        auto: key,
        useAuto: true,
        userTriggered: true,
      });
      expect(config.value.level).toBeGreaterThan(500);
      widths.push(config.value.width);
      if (key === 'FullRange') {
        expect(config.value).toMatchObject({ width: 499.5, level: 549.75 });
        const gray = Array.from(scalars, (value) =>
          Math.round(((value - 300) / config.value.width) * 255)
        );
        expect(gray[0]).toBe(0);
        expect(gray.at(-1)).toBe(255);
        expect(new Set(gray).size).toBe(256);
      }
    }
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[2]).toBeGreaterThan(widths[3]);
  });
});

describe('Projection automatic ranges', () => {
  it('keeps the complete source bounds and fits percentile windows to projected values', () => {
    const values = Float32Array.from({ length: 1000 }, (_, index) => index);
    const ranges = rangesFor(values)!;
    expect(ranges.FullRange).toEqual([0, 999]);
    for (const [key, percent] of Object.entries(WLAutoRanges)) {
      if (!percent) continue;
      expect(ranges[key as keyof typeof WLAutoRanges]).toEqual([
        Math.ceil((1000 * percent) / 100) - 1,
        Math.ceil(1000 * (1 - percent / 100)) - 1,
      ]);
    }
  });

  it('handles fractional OCT intensities without the integer bin bias', () => {
    const values = Float32Array.from(
      { length: 1000 },
      (_, index) => index * 0.0001
    );
    const ranges = rangesFor(values)!;
    expect(ranges.HighContrast[0]).toBeGreaterThan(0.004);
    expect(ranges.HighContrast[1]).toBeLessThan(0.096);
    expect(ranges.FullRange[1]).toBe(values[999]);
  });

  it.each([
    ['mean', [10, 12], [0, 22]],
    ['max', [20, 22], [0, 22]],
    ['sum', [50, 60], [0, 110]],
  ] as const)(
    'estimates %s contrast from physical slab samples',
    (method, projectedRange, fullRange) => {
      const ranges = rangesFor([0, 1, 2, 10, 11, 12, 20, 21, 22], [3, 3, 1], {
        axis: 1,
        first: 0,
        last: 2,
        method,
      })!;
      expect(ranges.LowContrast).toEqual(projectedRange);
      expect(ranges.FullRange).toEqual(fullRange);
    }
  );

  it('includes filler and genuine zero as ordinary intensity samples', () => {
    const ranges = rangesFor([-999, 0, 20, 40], [2, 2, 1], {
      axis: 1,
      first: 0,
      last: 1,
      method: 'mean',
    })!;
    expect(ranges.LowContrast).toEqual([-489.5, 20]);
    expect(ranges.FullRange).toEqual([-999, 40]);
  });

  it('includes genuine zero samples in the mean denominator', () => {
    const ranges = rangesFor(
      [0, 0, 0, 0, 6, 12, 0, 0, 0, 0, 6, 12],
      [2, 3, 2],
      { axis: 1, first: 0, last: 2, method: 'mean' }
    )!;
    expect(ranges.LowContrast).toEqual([1.8, 3.6]);
    expect(ranges.FullRange).toEqual([0, 12]);
  });

  it.each([
    [0, 0, 2, [1, 111]],
    [1, 0, 1, [5, 107]],
    [2, 0, 1, [50, 62]],
    [1, 1, 1, [10, 112]],
  ] as const)(
    'fits the selected axis %i and inclusive slab %i through %i',
    (axis, first, last, expected) => {
      const values = Array.from(
        { length: 12 },
        (_, index) =>
          100 * Math.floor(index / 6) +
          ((10 * Math.floor(index / 3)) % 20) +
          (index % 3)
      );
      const ranges = rangesFor(values, [3, 2, 2], {
        axis,
        first,
        last,
        method: 'mean',
      })!;
      expect(ranges.LowContrast).toEqual(expected);
      expect(ranges.FullRange).toEqual([0, 112]);
    }
  );

  it('retains a useful range when percentile cutoffs collapse', () => {
    const values = new Float32Array(1000);
    values[500] = 10;
    const ranges = rangesFor(values)!;
    expect(ranges.LowContrast).toEqual([0, 10]);
    expect(ranges.HighContrast).toEqual([0, 10]);
  });

  it('falls back to complete bounds for a constant projection of a variable source', () => {
    const ranges = rangesFor([-5, -5, 5, 5, -5, -5, 5, 5], [2, 2, 2], {
      axis: 1,
      first: 0,
      last: 1,
      method: 'mean',
    })!;
    expect(ranges.LowContrast).toEqual([-5, 5]);
    const { config } = create(ref(Float32Array.from([7, 7])));
    expect(config.value).toMatchObject({ width: 1, level: 7 });
  });
});
