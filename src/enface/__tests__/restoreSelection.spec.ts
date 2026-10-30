import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { disposePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import JSZip from 'jszip';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';
import { ManifestSchema, type StateFile } from '@/src/io/state-file/schema';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useEnFaceViewStore } from '@/src/enface/store';
import { useEnFaceInput } from '@/src/enface/useEnFaceInput';
import { useEnFaceOccupiedDepth } from '@/src/enface/useEnFaceOccupiedDepth';
import EnFaceControls from '@/src/enface/EnFaceControls.vue';
import { createThinRegionMask } from '@/src/enface/projectionMasks';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  createOccupiedDepthHandler,
  type MeasurementRequest,
} from '@/src/segmentation/measurements/occupiedDepthHandler';
import {
  activateAppPinia,
  makeImage,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { defer } from '@/src/utils';

let pinia: ReturnType<typeof activateAppPinia>;
beforeEach(() => {
  pinia = activateAppPinia();
  vi.stubGlobal('visualViewport', null);
});
enableAutoUnmount(afterEach);
afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

function createMeasurementWorker() {
  const handle = createOccupiedDepthHandler();
  const worker = {
    onmessage: null as Worker['onmessage'],
    postMessage(message: MeasurementRequest, transfer: Transferable[]) {
      const response = handle(structuredClone(message, { transfer }));
      queueMicrotask(() =>
        worker.onmessage?.call(
          worker as unknown as Worker,
          new MessageEvent('message', { data: response })
        )
      );
    },
    terminate() {},
  };
  return worker as unknown as Worker;
}

it('keeps the projection ready and restores the non-first segment after deferred mask decoding', async () => {
  useImageStatsStore().stats.oct = {
    scalarMin: 0,
    scalarMax: 1,
    autoRangeValues: {},
  };
  const image = await seatImage('oct', {
    dimensions: [2, 2, 2],
    spacing: [0.01, 0.01, 0.01],
  });
  const manifest = ManifestSchema.parse({
    version: '7.0.0',
    datasets: [],
    dataSources: [],
    segments: ['first', 'chosen'].map((id, index) => ({
      id,
      name: id,
      color: index ? [0, 255, 0, 255] : [255, 0, 0, 255],
      visible: true,
      locked: false,
    })),
    segmentations: [
      {
        id: 'segmentation',
        name: 'OCT layers',
        parentImage: 'saved-oct',
        order: ['first', 'chosen'],
        masks: ['first', 'chosen'].map((id) => ({
          id,
          segmentId: id,
          representations: {
            labelmap: {
              path: `${id}.vti`,
              extent: [0, 1, 0, 1, 0, 1],
            },
          },
        })),
      },
    ],
    viewByID: {
      view: {
        id: 'view',
        type: 'EnFace',
        name: 'En face',
        config: {
          'saved-oct': {
            enFace: {
              axis: 1,
              method: 'mean',
              depthStart: 0,
              depthEnd: null,
              highlightThin: true,
              thresholdMicrons: 15,
              segmentId: 'chosen',
            },
          },
        },
      },
    },
  });
  const { segmentIdMap } = useSegmentStore().deserialize(manifest);
  const dataIDMap = { 'saved-oct': 'oct' };
  useViewConfigStore().deserializeAll(manifest, dataIDMap, segmentIdMap);
  const reading = defer<void>();
  const release = defer<void>();
  const segmentation = useSegmentationStore();
  const restored = segmentation.deserialize({
    manifest,
    dataIDMap,
    segmentIdMap,
    stateFiles: ['first', 'chosen'].map((id) => ({
      archivePath: `${id}.vti`,
      file: new File([], `${id}.vti`),
    })),
    io: {
      write: async () => '',
      read: async (file) => {
        reading.resolve();
        await release.promise;
        return {
          image: makeImage({
            dimensions: [2, 2, 2],
            spacing: [0.01, 0.01, 0.01],
            values:
              file.name === 'chosen.vti'
                ? new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0])
                : new Uint8Array(8).fill(1),
          }),
        };
      },
    },
  });
  await reading.promise;
  let projection!: ReturnType<typeof useEnFaceInput>;
  let thickness!: ReturnType<typeof useEnFaceOccupiedDepth>;
  const wrapper = mount(
    defineComponent({
      setup() {
        projection = useEnFaceInput('view');
        thickness = useEnFaceOccupiedDepth(
          'view',
          {
            source: projection.source,
            slab: projection.specification,
            geometry: projection.geometry,
            blockedReason: computed(
              () => projection.controls.value.projectionReason
            ),
          },
          createMeasurementWorker
        );
        return () =>
          h(EnFaceControls, {
            ...projection.controls.value,
            settings: useEnFaceViewStore().configFor('view', 'oct'),
            thickness: thickness.controls.value,
          });
      },
    }),
    {
      global: {
        plugins: [pinia, createVuetify()],
        provide: {
          [CurrentImageInjectionKey as symbol]: { imageID: ref('oct') },
        },
      },
    }
  );
  try {
    await nextTick();
    expect(projection.source.currentImageData.value).toBe(image);
    expect(projection.geometry.value).not.toBeNull();
    expect(
      wrapper.get<HTMLInputElement>(
        '[data-testid="enface-thin-highlight"] input'
      ).element.checked
    ).toBe(true);
    expect(
      wrapper.get('[data-testid="enface-segmentation-segment"]').text()
    ).toContain('chosen');
    for (const control of ['thin-highlight', 'thickness-threshold-input'])
      expect(
        wrapper
          .get(`[data-testid="enface-${control}"] input`)
          .attributes('disabled')
      ).toBeDefined();
    expect(thickness.overlay.value.measurement).toBeNull();
    expect(thickness.overlay.value.appearance).toBeNull();

    // Saving while decoding must retain the chosen segment, too.
    const saved: StateFile = {
      zip: new JSZip(),
      manifest: { ...manifest, datasets: [{ id: 'oct', dataSourceId: 0 }] },
    };
    useEnFaceViewStore().serialize(saved);
    expect(saved.manifest.viewByID!.view.config!.oct.enFace).toMatchObject({
      segmentId: segmentIdMap.chosen,
      highlightThin: true,
    });
  } finally {
    release.resolve();
    await restored;
  }
  await flushPromises();
  expect(thickness.overlay.value.appearance?.color).toEqual([0, 255, 0, 255]);
  expect(thickness.overlay.value.measurement?.counts).toEqual(
    new Uint32Array([1, 0, 0, 0])
  );
  expect(
    Array.from(
      createThinRegionMask(thickness.overlay.value.measurement!, 15, 10)
    )
  ).toEqual([1, 0, 0, 0]);
  for (const control of ['thin-highlight', 'thickness-threshold-input'])
    expect(
      wrapper
        .get(`[data-testid="enface-${control}"] input`)
        .attributes('disabled')
    ).toBeUndefined();
});
