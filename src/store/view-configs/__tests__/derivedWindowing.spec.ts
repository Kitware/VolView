import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';
import {
  computed,
  defineComponent,
  effectScope,
  h,
  nextTick,
  shallowRef,
} from 'vue';
import { mount } from '@vue/test-utils';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import CurrentImageProvider from '@/src/components/CurrentImageProvider.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { slabWindowRanges } from '@/src/core/slab/windowRanges';
import { useImageStore } from '@/src/store/datasets-images';
import { useDatasetStore } from '@/src/store/datasets';
import { useViewStore } from '@/src/store/views';
import { useViewWindowingRanges } from '@/src/composables/useViewWindowingRanges';
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
  it('does not restore removed dataset contrast while the image provider unbinds', async () => {
    const datasets = useDatasetStore();
    const image = vtkImageData.newInstance();
    image.setDimensions(2, 2, 2);
    image.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 1,
        values: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]),
      })
    );
    const imageId = 'retinal-source';
    useImageStatsStore().stats[imageId] = {
      scalarMin: 0,
      scalarMax: 7,
      autoRangeValues: { FullRange: [0, 7] },
    };
    useImageStore().addVTKImageData('source.nrrd', image, { id: imageId });
    const views = useViewStore();
    const viewId = views.layoutViews[0].id;
    views.setDataForView(viewId, imageId);
    const consumer = defineComponent({
      setup() {
        const source = useCurrentImage();
        const ranges = computed(() =>
          source.currentImageData.value
            ? slabWindowRanges(source.currentImageData.value, {
                axis: 1,
                first: 0,
                last: 1,
                method: 'mean',
              })
            : null
        );
        const config = useViewWindowingRanges(
          viewId,
          source.currentImageID,
          ranges
        );
        return () => h('output', String(config.value.width));
      },
    });
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            CurrentImageProvider,
            {
              imageId: views.getView(viewId)?.dataID,
            },
            () => h(consumer)
          ),
      })
    );
    const store = useWindowingStore();
    const savedConfig = () => {
      const state: StateFile = {
        zip: new JSZip(),
        manifest: {
          version: '7.0.0',
          datasets: [{ id: imageId, dataSourceId: 0 }],
          dataSources: [{ id: 0, type: 'uri', uri: 'source.nrrd' }],
          viewByID: { [viewId]: { ...views.getView(viewId)! } },
        },
      };
      store.serialize(state);
      return state.manifest.viewByID?.[viewId].config ?? {};
    };
    try {
      expect(wrapper.get('output').text()).toBe('7');
      expect(savedConfig()).toHaveProperty(imageId);
      datasets.remove(imageId);
      expect(savedConfig()).not.toHaveProperty(imageId);
      await nextTick();
      expect(savedConfig()).not.toHaveProperty(imageId);
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    { manual: false, stopFirst: false },
    { manual: false, stopFirst: true },
    { manual: true, stopFirst: false },
    { manual: true, stopFirst: true },
  ])(
    'preserves the logical window across renderer remounts (manual=$manual, stopFirst=$stopFirst)',
    ({ manual, stopFirst }) => {
      const store = useWindowingStore();
      useImageStatsStore().stats.image = {
        scalarMin: 0,
        scalarMax: 100,
        autoRangeValues: { LowContrast: [5, 95] },
      };
      const previous = effectScope();
      const replacement = effectScope();
      try {
        previous.run(() =>
          useViewWindowingRanges('derived', 'image', projectedRanges, {
            defaultAuto: 'LowContrast',
          })
        );
        if (manual)
          store.updateConfig('derived', 'image', { width: 150, level: 1420 });
        if (stopFirst) previous.stop();
        const config = replacement.run(() =>
          useViewWindowingRanges('derived', 'image', projectedRanges, {
            defaultAuto: 'LowContrast',
          })
        )!;
        const expected = manual
          ? { width: 150, level: 1420, useAuto: false }
          : { width: 980, level: 1500, useAuto: true };
        expect(config.value).toMatchObject(expected);
        previous.stop();
        expect(config.value).toMatchObject(expected);
        store.resetConfig('derived', 'image');
        expect(config.value).toMatchObject({
          width: 980,
          level: 1500,
          auto: 'LowContrast',
          useAuto: true,
        });
      } finally {
        previous.stop();
        replacement.stop();
      }
      expect(store.getRange('derived', 'image')).toEqual([1000, 2000]);
      store.removeView('derived');
      expect(store.getRange('derived', 'image')).toEqual([0, 100]);
    }
  );

  it('keeps ranges per logical source and removes them with the data', async () => {
    const store = useWindowingStore();
    const sourceId = shallowRef<string | undefined>('first');
    const ranges = shallowRef<typeof projectedRanges | null>(projectedRanges);
    const scope = effectScope();
    try {
      const config = scope.run(() =>
        useViewWindowingRanges('derived', sourceId, ranges, {
          defaultAuto: 'LowContrast',
        })
      )!;
      expect(config.value.width).toBe(980);
      sourceId.value = 'second';
      await nextTick();
      expect(store.getRange('derived', 'first')).toEqual([1000, 2000]);
      expect(config.value.width).toBe(980);
      ranges.value = null;
      await nextTick();
      expect(store.getRange('derived', 'second')).toEqual([1010, 1990]);
      expect(config.value.width).toBe(980);
      ranges.value = projectedRanges;
      await nextTick();
      expect(config.value.width).toBe(980);
      sourceId.value = undefined;
      await nextTick();
      expect(store.getRange('derived', 'second')).toEqual([1000, 2000]);
      store.removeData('second', 'derived');
      expect(store.getRange('derived', 'second')).toEqual([0, 1]);
      expect(store.getRange('derived', 'first')).toEqual([1000, 2000]);
      store.removeData('first');
      expect(store.getRange('derived', 'first')).toEqual([0, 1]);
    } finally {
      scope.stop();
    }
  });

  it('keeps pending projection contrast independent of source intensity units', async () => {
    const store = useWindowingStore();
    useImageStatsStore().stats.image = {
      scalarMin: -10000,
      scalarMax: 10000,
      autoRangeValues: { LowContrast: [-9000, 9000] },
    };
    const ranges = shallowRef<typeof projectedRanges | null>(null);
    const scope = effectScope();
    try {
      const config = scope.run(() =>
        useViewWindowingRanges('derived', 'image', ranges, {
          defaultAuto: 'LowContrast',
        })
      )!;
      expect(config.value).toMatchObject({ width: 1, level: 0.5 });
      expect(store.getRange('derived', 'image')).toEqual([0, 1]);
      ranges.value = projectedRanges;
      await nextTick();
      expect(config.value).toMatchObject({ width: 980, level: 1500 });
      ranges.value = null;
      await nextTick();
      expect(config.value).toMatchObject({ width: 980, level: 1500 });
      expect(store.getRange('derived', 'image')).toEqual([1010, 1990]);
    } finally {
      scope.stop();
    }
    store.removeData('image');
    expect(store.getRange('derived', 'image')).toEqual([-10000, 10000]);
  });

  it('uses a view-specific automatic default while preserving restored manual and chosen automatic windows', () => {
    const store = useWindowingStore();
    store.deserialize('manual', {
      image: {
        window: {
          preset: 'Grayscale',
          visibility: true,
          width: 150,
          level: 1420,
          useAuto: false,
          auto: 'FullRange',
          userTriggered: false,
        },
      },
    });
    store.deserialize('chosen', {
      image: {
        window: {
          preset: 'Grayscale',
          visibility: true,
          auto: 'FullRange',
          useAuto: true,
          userTriggered: true,
        },
      },
    });
    const scope = effectScope();
    try {
      const configs = scope.run(() =>
        ['fresh', 'manual', 'chosen'].map((view) =>
          useViewWindowingRanges(view, 'image', projectedRanges, {
            defaultAuto: 'LowContrast',
          })
        )
      )!;
      expect(configs[0].value).toMatchObject({
        auto: 'LowContrast',
        useAuto: true,
        width: 980,
        level: 1500,
      });
      expect(configs[1].value).toMatchObject({
        auto: 'FullRange',
        useAuto: false,
        width: 150,
        level: 1420,
      });
      expect(configs[2].value).toMatchObject({
        auto: 'FullRange',
        useAuto: true,
        width: 1000,
        level: 1500,
      });
      store.resetConfig('fresh', 'image');
      expect(configs[0].value.auto).toBe('LowContrast');
      expect(store.getConfig('raw', 'image').auto).toBe('FullRange');
    } finally {
      scope.stop();
    }
  });

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

  it('rejects invalid ranges without changing the resolved window', () => {
    const store = useWindowingStore();
    store.setAutoRangeValues('derived', 'image', projectedRanges);
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
    expect(store.getConfig('derived', 'image').width).toBe(1);
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

  it.each([false, true])(
    'preserves a tiny positive window through rendering configuration (automatic=%s)',
    (automatic) => {
      const store = useWindowingStore();
      const scope = effectScope();
      const ranges = {
        FullRange: [0, 2e-14],
        LowContrast: [0, 2e-14],
        MediumContrast: [0, 2e-14],
        HighContrast: [0, 2e-14],
      } satisfies typeof projectedRanges;
      if (!automatic)
        store.updateConfig('derived', 'image', { width: 2e-14, level: 1e-14 });
      try {
        const config = scope.run(() =>
          useViewWindowingRanges('derived', 'image', ranges)
        )!;
        expect(config.value).toMatchObject({
          width: 2e-14,
          level: 1e-14,
          useAuto: automatic,
        });
        expect(store.getInternalConfig('derived', 'image')?.width).toBe(2e-14);
      } finally {
        scope.stop();
      }
    }
  );

  it.each([false, true])(
    'saves effective default and chosen auto windows after restore (chosen=%s)',
    (chosen) => {
      const store = useWindowingStore();
      store.setAutoRangeValues('derived', 'image', projectedRanges);
      if (chosen)
        store.updateConfig('derived', 'image', { auto: 'HighContrast' }, true);
      else store.resetConfig('derived', 'image');
      const auto = chosen ? 'HighContrast' : 'FullRange';
      const width = chosen ? 900 : 1000;
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
        width,
        level: 1500,
        auto,
        useAuto: true,
        userTriggered: chosen,
      });
      expect(JSON.stringify(state.manifest)).not.toContain('FullRange":[');
      expect(JSON.stringify(state.manifest)).not.toContain(
        'autoRangeOverrides'
      );
      store.removeView('derived');
      store.deserialize('restored', config);
      useImageStatsStore().stats.image = {
        scalarMin: -100,
        scalarMax: 100,
        autoRangeValues: { FullRange: [-100, 100], HighContrast: [-90, 90] },
      };
      store.setAutoRangeValues('restored', 'image', null);
      expect(store.getConfig('restored', 'image')).toMatchObject({
        width,
        level: 1500,
        auto,
        useAuto: true,
      });
      store.setAutoRangeValues('restored', 'image', {
        FullRange: [10000, 20000],
        LowContrast: [10100, 19900],
        MediumContrast: [10200, 19800],
        HighContrast: [10500, 19500],
      });
      expect(store.getConfig('restored', 'image')).toMatchObject({
        width: width * 10,
        level: 15000,
        auto,
        useAuto: true,
      });
      store.removeView('restored');
      expect(store.getConfig('derived', 'image').width).toBe(200);
    }
  );
});
