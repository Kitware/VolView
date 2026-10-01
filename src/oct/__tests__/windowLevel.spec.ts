import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { computed, effectScope, nextTick, ref } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewStore } from '@/src/store/views';
import { useEnFaceWindowing } from '@/src/oct/useEnFaceWindowing';
import { projectEnFace } from '@/src/oct/projection';
import {
  windowLevelFromDrag,
  thinRegionColor,
  paintThinRegionPixels,
  paintProjectionIntensities,
  projectionWindowRanges,
} from '@/src/oct/windowLevel';
import { WLAutoRanges, WL_HIST_BINS } from '@/src/constants';

enableAutoUnmount(afterEach);
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function create(
  values = ref<Float32Array | null>(Float32Array.from([0, 25, 50, 75, 100])),
  viewId = ref('view'),
  imageId = ref<string | null>('image')
) {
  const scope = effectScope();
  scopes.push(scope);
  const ranges = computed(() =>
    values.value ? (projectionWindowRanges(values.value)?.ranges ?? null) : null
  );
  const config = scope.run(() => useEnFaceWindowing(viewId, imageId, ranges))!;
  return { config, scope, values, viewId, imageId, store: useWindowingStore() };
}

describe('En face windowing with normal view controls', () => {
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
    const stats = projectionWindowRanges(values)!;
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
    const stats = projectionWindowRanges(values)!;
    expect(stats.ranges.HighContrast[0]).toBeGreaterThan(0.004);
    expect(stats.ranges.HighContrast[1]).toBeLessThan(0.096);
    expect(stats.ranges.FullRange[1]).toBe(values[999]);
  });

  it('handles constant/empty data and rejects corrupt projection intensities', () => {
    expect(projectionWindowRanges([])).toBeNull();
    const constant = projectionWindowRanges(Float32Array.from([7, 7, 7]))!;
    expect(Object.values(constant.ranges)).toEqual([
      [7, 7],
      [7, 7],
      [7, 7],
      [7, 7],
    ]);
    expect(constant.width).toBeGreaterThan(0);
    expect(() => projectionWindowRanges([1, NaN])).toThrow(/finite/);
  });
});
describe('En face window/level drag and texture overlay', () => {
  it('rejects malformed drag inputs instead of writing NaN contrast into the view', () => {
    expect(() =>
      windowLevelFromDrag(
        { width: 40, level: 50 },
        { min: 0, max: 100 },
        { x: NaN, y: 10 },
        { width: 200, height: 100 }
      )
    ).toThrow(/finite/);
    expect(() =>
      windowLevelFromDrag(
        { width: 0, level: 50 },
        { min: 0, max: 100 },
        { x: 1, y: 10 },
        { width: 200, height: 100 }
      )
    ).toThrow(/positive/);
  });
  it('matches VTK normalized viewport sensitivity: horizontal level, upward width', () => {
    const result = windowLevelFromDrag(
      { width: 40, level: 50 },
      { min: 0, max: 100 },
      { x: 50, y: -20 },
      { width: 200, height: 100 }
    );
    expect(result.level).toBeCloseTo(50 + 25 / (1 + 1 / 256), 2);
    expect(result.width).toBeCloseTo(40 + 20 / (1 + 1 / 256), 2);
  });
  it('clamps width positive and level to the projected intensity range', () => {
    expect(
      windowLevelFromDrag(
        { width: 40, level: 50 },
        { min: 0, max: 100 },
        { x: 10000, y: 10000 },
        { width: 200, height: 100 }
      )
    ).toEqual({ width: 1e-12, level: 100 });
  });
  it('windows reflectivity before filling while clipping intensities outside the display range', () => {
    const pixels = new Uint8ClampedArray(5 * 4);
    paintProjectionIntensities([-20, 0, 50, 100, 120], pixels, {
      width: 100,
      level: 50,
    });
    expect(Array.from(pixels)).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255,
      255, 255, 255,
    ]);
  });
  it('paints only present thin A-lines, leaving absent, equal and thick regions unchanged', () => {
    const gray = Uint8ClampedArray.from({ length: 6 * 4 }, (_, index) =>
      index % 4 === 3 ? 255 : 100
    );
    const count = paintThinRegionPixels(gray, [0, 20.8, 31, 52, NaN, -1], 31, {
      color: [35, 215, 190, 255],
      alpha: 0.3,
    });
    expect(count).toBe(1);
    expect(Array.from(gray.slice(4, 8))).toEqual([81, 135, 127, 255]);
    for (const index of [0, 2, 3, 4, 5])
      expect(Array.from(gray.slice(index * 4, index * 4 + 4))).toEqual([
        100, 100, 100, 255,
      ]);
  });
  it('tints reflectivity with the selected segment color and shared fill opacity', () => {
    const dark = thinRegionColor(20, [35, 215, 190, 255], 0.3);
    const bright = thinRegionColor(200, [35, 215, 190, 255], 0.3);
    expect(dark).toEqual([25, 79, 71, 255]);
    expect(bright).toEqual([151, 205, 197, 255]);
    expect(bright[0]).toBeGreaterThan(dark[0]);
    expect(thinRegionColor(100, [255, 0, 0, 255], 0.3)).toEqual([
      147, 70, 70, 255,
    ]);
    expect(thinRegionColor(100, [0, 255, 0, 255], 0.3)).toEqual([
      70, 147, 70, 255,
    ]);
    expect(thinRegionColor(100, [35, 215, 190, 0], 0)).toEqual([
      100, 100, 100, 255,
    ]);
  });
});
