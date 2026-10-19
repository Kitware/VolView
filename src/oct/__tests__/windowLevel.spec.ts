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
import { useDerivedImageWindowing } from '@/src/composables/useDerivedImageWindowing';
import { imageWindowRanges } from '@/src/utils/imageWindowing';
import { projectEnFace } from '@/src/oct/projection';
import { createThinRegionOverlay } from '@/src/oct/thinRegionOverlay';
import {
  compositeReferencePixels,
  scalarReferencePixels,
  scalarImageFixture,
} from './scalarDisplayFixtures';
import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import VtkSliceViewWindowManipulator from '@/src/components/vtk/VtkSliceViewWindowManipulator.vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import type { VtkViewApi } from '@/src/types/vtk-types';

enableAutoUnmount(afterEach);
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

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
    values.value ? (imageWindowRanges(values.value)?.ranges ?? null) : null
  );
  const config = scope.run(() => {
    const current = useDerivedImageWindowing(viewId, imageId, ranges);
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
  it.each(['mean', 'max', 'sum'] as const)(
    'renders a constant high-valued %s projection at midpoint while missing pixels stay black',
    (method) => {
      const result = projectEnFace({
        volume: {
          scalars: Uint16Array.from([65535, 0, 65535, 0]),
          dimensions: [2, 2, 1],
          spacing: [1, 1, 1],
          paddingRanges: [{ firstFrame: 0, lastFrame: 0, min: 0, max: 0 }],
        },
        axis: 1,
        method,
        depthStart: 0,
        depthEnd: 1,
      });
      expect(result.values[0]).toBe(method === 'sum' ? 131070 : 65535);
      expect(result.values[1]).toBeNaN();
      const { config, store } = create(ref(result.values));
      for (const auto of Object.keys(WLAutoRanges) as Array<
        keyof typeof WLAutoRanges
      >) {
        store.updateConfig('view', 'image', { auto }, true);
        const pixels = new Uint8ClampedArray(8);
        pixels.set(scalarReferencePixels(result.values, config.value));
        expect(Array.from(pixels)).toEqual([128, 128, 128, 255, 0, 0, 0, 255]);
      }
    }
  );

  it.each([-65535, 0, 7, 1234, 0.0001])(
    'keeps a finite constant projection of %s near midpoint',
    (value) => {
      const values = Float32Array.from([value, NaN]);
      const { config } = create(ref(values));
      const pixels = new Uint8ClampedArray(8);
      pixels.set(scalarReferencePixels(values, config.value));
      expect(pixels[0]).toBeGreaterThanOrEqual(127);
      expect(pixels[0]).toBeLessThanOrEqual(128);
      expect(Array.from(pixels.slice(4))).toEqual([0, 0, 0, 255]);
    }
  );

  it('retains fractional full-range contrast and explicit manual windows for constant projections', () => {
    const values = ref<Float32Array | null>(
      Float32Array.from([1 / 8192, 2 / 8192, 3 / 8192, NaN])
    );
    const { config, store } = create(values);
    const pixels = new Uint8ClampedArray(16);
    pixels.set(scalarReferencePixels(values.value!, config.value));
    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);

    store.updateConfig('view', 'image', { width: 20, level: 65540 }, true);
    for (const [value, gray] of [
      [65535, 64],
      [65540, 128],
    ]) {
      values.value = Float32Array.from([value, NaN]);
      pixels.set(scalarReferencePixels(values.value, config.value));
      expect(config.value).toMatchObject({
        width: 20,
        level: 65540,
        useAuto: false,
      });
      expect(Array.from(pixels.slice(0, 8))).toEqual([
        gray,
        gray,
        gray,
        255,
        0,
        0,
        0,
        255,
      ]);
    }
  });

  it('fits projected Full Range and recalculates it when a sum/slab changes intensity units', () => {
    const { config, values } = create();
    expect(config.value).toMatchObject({
      width: 100,
      level: 50,
      userTriggered: false,
      auto: 'FullRange',
      useAuto: true,
    });
    values.value = Float32Array.from([0, 250, 500, 750, 1000]);
    expect(config.value).toMatchObject({
      width: 1000,
      level: 500,
      useAuto: true,
    });
  });

  it.each([false, true])(
    'keeps manually restored contrast with userTriggered=%s across range changes',
    (userTriggered) => {
      const store = useWindowingStore();
      store.deserialize('view', {
        image: {
          window: {
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
      expect(config.value).toMatchObject({ width: 25, level: 20 });
      store.updateConfig('view', 'image', { width: 30, level: 24 }, true);
      expect(config.value).toMatchObject({ width: 30, level: 24 });
    }
  );

  it('preserves a selected percentile through range changes and a restored auto config', () => {
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
    expect(config.value).toMatchObject({ auto: 'HighContrast', useAuto: true });
    expect(config.value.width).toBeCloseTo(firstWidth * 10);
    store.deserialize('restored', {
      image: {
        window: { auto: 'MediumContrast', useAuto: true, userTriggered: true },
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

  it('resets through the real Reset Views action to projected Full Range without recursive updates', async () => {
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

  it('clears ranges on dataset/view changes and projection loss without deleting saved choices', () => {
    const { config, store, viewId, imageId, values } = create();
    store.updateConfig('view', 'image', { auto: 'HighContrast' }, true);
    imageId.value = 'second-image';
    expect(store.getConfig('view', 'image')).toMatchObject({
      width: 1,
      level: 0.5,
      auto: 'HighContrast',
    });
    expect(config.value).toMatchObject({ width: 100, level: 50 });
    viewId.value = 'second-view';
    expect(store.getConfig('view', 'second-image').width).toBe(1);
    expect(config.value.width).toBe(100);
    values.value = null;
    expect(config.value.width).toBe(1);
    values.value = Float32Array.from([10, 30]);
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
    expect(store.getConfig('view', 'image').width).toBe(1);
    values.value = Float32Array.from([0, 1000]);
    await nextTick();
    expect(store.getConfig('view', 'image').width).toBe(1);
  });

  it('waits for a complete projection before registering derived ranges', () => {
    const values = ref<Float32Array | null>(null);
    const { config } = create(values);
    expect(config.value.width).toBe(1);
    values.value = Float32Array.from([5, 45]);
    expect(config.value).toMatchObject({ width: 40, level: 25 });
  });

  it('uses projected pixels for all four actual shared Auto menu choices, including sum', async () => {
    const views = useViewStore();
    const view = views.layoutViews[0];
    views.setDataForView(view.id, 'image');
    views.setActiveView(view.id);
    const scalars = Float32Array.from(
      { length: 2000 },
      (_, index) => 300 + (index % 1000) / 2
    );
    const result = projectEnFace({
      volume: { scalars, dimensions: [1000, 2, 1], spacing: [1, 1, 1] },
      axis: 1,
      method: 'sum',
      depthStart: 0,
      depthEnd: 1,
    });
    useImageStatsStore().stats.image = {
      scalarMin: 300,
      scalarMax: 799.5,
      autoRangeValues: { FullRange: [300, 799.5], HighContrast: [325, 775] },
    };
    const { config, store } = create(ref(result.values), ref(view.id));
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
      expect(config.value.level).toBeGreaterThan(1000);
      widths.push(config.value.width);
      if (key === 'FullRange') {
        expect(config.value).toMatchObject({ width: 999, level: 1099.5 });
        const gray = Array.from(result.values, (value) =>
          Math.round(((value - 600) / config.value.width) * 255)
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

describe('Projection histogram windows', () => {
  it('fits exact Full Range and approximates percentile cutoffs within one of 512 bins', () => {
    const values = Float32Array.from({ length: 1000 }, (_, index) => index);
    const stats = imageWindowRanges(values)!;
    expect(stats.ranges.FullRange).toEqual([0, 999]);
    for (const [key, percent] of Object.entries(WLAutoRanges)) {
      if (!percent) continue;
      const range = stats.ranges[key as keyof typeof WLAutoRanges];
      const expected = [
        Math.ceil((1000 * percent) / 100) - 1,
        Math.ceil(1000 * (1 - percent / 100)) - 1,
      ];
      expect(Math.abs(range[0] - expected[0])).toBeLessThanOrEqual(
        999 / WL_HIST_BINS
      );
      expect(Math.abs(range[1] - expected[1])).toBeLessThanOrEqual(
        999 / WL_HIST_BINS
      );
    }
  });

  it('handles fractional OCT intensities without the integer +1 bin bias', () => {
    const values = Float32Array.from(
      { length: 1000 },
      (_, index) => index * 0.0001
    );
    const stats = imageWindowRanges(values)!;
    expect(stats.ranges.HighContrast[0]).toBeGreaterThan(0.004);
    expect(stats.ranges.HighContrast[1]).toBeLessThan(0.096);
    expect(stats.ranges.FullRange[1]).toBe(values[999]);
  });

  it('handles constant/empty data and rejects corrupt projection intensities', () => {
    expect(imageWindowRanges([])).toBeNull();
    const constant = imageWindowRanges(Float32Array.from([7, 7, 7]))!;
    expect(Object.values(constant.ranges)).toEqual([
      [7, 7],
      [7, 7],
      [7, 7],
      [7, 7],
    ]);
    expect(constant.width).toBeGreaterThan(0);
    expect(imageWindowRanges([1, NaN])?.ranges.FullRange).toEqual([1, 1]);
    expect(() => imageWindowRanges([1, Infinity])).toThrow(/finite/);
  });
});
describe('En face texture windowing and segment overlay', () => {
  it.each([
    ['native decimal equality', 0.003872, 35, 135.52, false],
    ['slider decimal equality', 0.0039, 13, 50.7, false],
    ['two-ULP decimal equality', 0.000511, 293, 149.723, false],
    [
      'native thickness below by 1e-12 µm',
      0.003872,
      35,
      135.520000000001,
      true,
    ],
    ['slider thickness below by 1e-12 µm', 0.0039, 13, 50.700000000001, true],
    ['tiny thickness below by 1e-16 µm', 1e-18, 1, 1.1e-15, true],
    ['above threshold', 0.003872, 35, 135.51, false],
    ['absent label', 0.003872, 0, 135.52, false],
    ['zero threshold', 0.003872, 35, 0, false],
  ] as const)(
    'paints calibrated projection pixels for %s',
    (_, spacing, occupied, thresholdMicrons, highlighted) => {
      const depth = Math.max(2, occupied);
      const dimensions = [3, depth, 1];
      const labels = new Uint8Array(3 * depth);
      for (let y = 0; y < occupied; y += 1) labels[y * 3] = 1;
      const result = projectEnFace({
        volume: {
          dimensions,
          spacing: [0.01, spacing, 0.2],
          scalars: new Uint8Array(3 * depth).fill(100),
        },
        axis: 1,
        method: 'mean',
        depthStart: 0,
        depthEnd: depth - 1,
        segmentation: { dimensions, scalars: labels },
      });
      const pixels = new Uint8ClampedArray(12);
      pixels.set(
        scalarReferencePixels(result.values, {
          width: 200,
          level: 100,
        })
      );
      const overlay = createThinRegionOverlay(result, thresholdMicrons, {
        color: [0, 255, 0, 255],
        alpha: 1,
      });
      expect(Array.from(overlay)).toEqual([
        ...(highlighted ? [0, 255, 0, 255] : [0, 0, 0, 0]),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]);
      pixels.set(compositeReferencePixels(pixels, overlay));
      expect(Array.from(pixels)).toEqual([
        ...(highlighted ? [0, 255, 0, 255] : [128, 128, 128, 255]),
        128,
        128,
        128,
        255,
        128,
        128,
        128,
        255,
      ]);
    }
  );
  it('windows reflectivity before filling while clipping intensities outside the display range', () => {
    const pixels = new Uint8ClampedArray(5 * 4);
    pixels.set(
      scalarReferencePixels([-20, 0, 50, 100, 120], {
        width: 100,
        level: 50,
      })
    );
    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255,
      255, 255, 255,
    ]);
  });
  it('paints only present thin A-lines, leaving absent, equal and thick regions unchanged', () => {
    const gray = Uint8ClampedArray.from({ length: 6 * 4 }, (_, index) =>
      index % 4 === 3 ? 255 : 100
    );
    const overlay = createThinRegionOverlay(
      scalarImageFixture(new Float32Array(6).fill(100), [
        0,
        20.8,
        31,
        52,
        NaN,
        -1,
      ]),
      31,
      {
        color: [35, 215, 190, 255],
        alpha: 0.3,
      }
    );
    expect(Array.from(overlay.slice(4, 8))).toEqual([35, 215, 190, 77]);
    expect(
      overlay.filter((value, index) => index % 4 === 3 && value > 0)
    ).toHaveLength(1);
    gray.set(compositeReferencePixels(gray, overlay));
    expect(Array.from(gray.slice(4, 8))).toEqual([80, 135, 127, 255]);
    for (const index of [0, 2, 3, 4, 5])
      expect(Array.from(gray.slice(index * 4, index * 4 + 4))).toEqual([
        100, 100, 100, 255,
      ]);
  });
  it('keeps half-channel grayscale and fill within the encoded texture precision', () => {
    const pixels = new Uint8ClampedArray(3 * 4);
    pixels.set(
      scalarReferencePixels([0.5 / 255, 1.5 / 255, 2.5 / 255], {
        width: 1,
        level: 0.5,
      })
    );
    expect(Array.from(pixels)).toEqual([
      1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255,
    ]);
    const overlay = createThinRegionOverlay(
      scalarImageFixture([0.5 / 255, 1.5 / 255, 2.5 / 255], [1, 2, 3]),
      3,
      {
        color: [0, 2, 4, 255],
        alpha: 0.5,
      }
    );
    expect(Array.from(overlay)).toEqual([
      0, 2, 4, 128, 0, 2, 4, 128, 0, 0, 0, 0,
    ]);
    pixels.set(compositeReferencePixels(pixels, overlay));
    expect(Array.from(pixels)).toEqual([
      0, 2, 3, 255, 1, 2, 3, 255, 3, 3, 3, 255,
    ]);
  });
});
