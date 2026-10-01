import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useImageStatsStore } from '@/src/store/image-stats';
import { ManifestSchema, type StateFile } from '@/src/io/state-file/schema';

beforeEach(() => setActivePinia(createPinia()));
const projectedRanges = {
  FullRange: [1000, 2000],
  LowContrast: [1010, 1990],
  MediumContrast: [1020, 1980],
  HighContrast: [1050, 1950],
} satisfies Parameters<
  ReturnType<typeof useWindowingStore>['setAutoRangeValues']
>[2];

describe('Runtime automatic windows for derived images', () => {
  it('prefers derived ranges to source histogram and source-unit runtime defaults for only the given view', () => {
    const store = useWindowingStore();
    store.runtimeConfigWindowLevel = { width: 60, level: 30 };
    useImageStatsStore().stats.image = {
      scalarMin: 0,
      scalarMax: 100,
      autoRangeValues: { FullRange: [0, 100], HighContrast: [5, 95] },
    };
    store.setAutoRangeValues('derived', 'image', projectedRanges);
    expect(store.getConfig('derived', 'image')).toMatchObject({
      width: 1000,
      level: 1500,
      useAuto: true,
    });
    expect(store.getConfig('raw', 'image')).toMatchObject({
      width: 60,
      level: 30,
      useAuto: false,
    });
    store.updateConfig('derived', 'image', { auto: 'HighContrast' }, true);
    expect(store.getConfig('derived', 'image')).toMatchObject({
      width: 900,
      level: 1500,
      auto: 'HighContrast',
    });
    store.resetConfig('derived', 'image');
    expect(store.getConfig('derived', 'image')).toMatchObject({
      width: 1000,
      level: 1500,
      auto: 'FullRange',
    });
    expect(useImageStatsStore().stats.image.autoRangeValues).toEqual({
      FullRange: [0, 100],
      HighContrast: [5, 95],
    });
  });

  it('removes overrides with both deletion APIs, scoped to the requested pair', () => {
    const store = useWindowingStore();
    store.setAutoRangeValues('a', 'one', projectedRanges);
    store.setAutoRangeValues('b', 'one', projectedRanges);
    store.setAutoRangeValues('a', 'two', projectedRanges);
    store.removeData('one', 'a');
    expect(store.getConfig('a', 'one').width).toBe(1);
    expect(store.getConfig('b', 'one').width).toBe(1000);
    expect(store.getConfig('a', 'two').width).toBe(1000);
    store.removeData('one');
    expect(store.getConfig('b', 'one').width).toBe(1);
    expect(store.getConfig('a', 'two').width).toBe(1000);
    store.removeView('a');
    expect(store.getConfig('a', 'two').width).toBe(1);
  });

  it('rejects invalid ranges and avoids duplicate change events for identical ranges', () => {
    const store = useWindowingStore();
    let count = 0;
    const listener = store.WindowingUpdateEvent.on(() => {
      count += 1;
    });
    store.setAutoRangeValues('derived', 'image', projectedRanges);
    store.setAutoRangeValues('derived', 'image', { ...projectedRanges });
    expect(count).toBe(1);
    expect(() =>
      store.setAutoRangeValues('derived', 'image', {
        ...projectedRanges,
        HighContrast: [NaN, 2000],
      })
    ).toThrow(/finite/);
    expect(() =>
      store.setAutoRangeValues('derived', 'image', {
        ...projectedRanges,
        HighContrast: [2000, 1000],
      })
    ).toThrow(/ordered/);
    expect(store.getConfig('derived', 'image').width).toBe(1000);
    store.setAutoRangeValues('derived', 'image', null);
    expect(count).toBe(2);
    expect(store.getConfig('derived', 'image').width).toBe(1);
    listener.off();
  });

  it('uses a positive automatic window for a constant projection', () => {
    const store = useWindowingStore();
    store.setAutoRangeValues('derived', 'image', {
      FullRange: [7, 7],
      LowContrast: [7, 7],
      MediumContrast: [7, 7],
      HighContrast: [7, 7],
    });
    const config = store.getConfig('derived', 'image');
    expect(config.width).toBeGreaterThan(0);
    expect(config.level).toBe(7);
    expect(
      (7 - (config.level! - config.width! / 2)) / config.width!
    ).toBeCloseTo(0.5, 3);
  });

  it('saves only the chosen auto key and regenerates its ranges for the restored view', () => {
    const store = useWindowingStore();
    store.setAutoRangeValues('derived', 'image', projectedRanges);
    store.updateConfig('derived', 'image', { auto: 'HighContrast' }, true);
    const state: StateFile = {
      zip: new JSZip(),
      manifest: {
        version: '7.0.0',
        datasets: [{ id: 'image', dataSourceId: 0 }],
        dataSources: [{ id: 0, type: 'uri', uri: 'oct.dcm' }],
        viewByID: {
          derived: {
            id: 'derived',
            type: 'EnFace',
            name: 'En face',
            dataID: 'image',
            options: {},
          },
        },
      },
    };
    store.serialize(state);
    const parsed = ManifestSchema.parse(state.manifest);
    const config = parsed.viewByID!.derived.config!;
    expect(config.image.window).toMatchObject({
      auto: 'HighContrast',
      useAuto: true,
      userTriggered: true,
    });
    expect(JSON.stringify(state.manifest)).not.toContain('FullRange":[');
    expect(JSON.stringify(state.manifest)).not.toContain('autoRangeOverrides');
    store.removeView('derived');
    store.deserialize('restored', config);
    store.setAutoRangeValues('restored', 'image', {
      FullRange: [10000, 20000],
      LowContrast: [10100, 19900],
      MediumContrast: [10200, 19800],
      HighContrast: [10500, 19500],
    });
    expect(store.getConfig('restored', 'image')).toMatchObject({
      width: 9000,
      level: 15000,
      auto: 'HighContrast',
      useAuto: true,
    });
    expect(store.getConfig('derived', 'image').width).toBe(1);
  });
});
