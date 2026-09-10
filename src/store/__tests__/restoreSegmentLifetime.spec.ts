import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createApp } from 'vue';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { useSegmentStore } from '@/src/store/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useImageStatsStore } from '@/src/store/image-stats';
import { defer } from '@/src/utils';
import { manifestForImages, seatImage, store } from './segmentMaskFixtures';

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  pinia = createPinia().use(CorePiniaProviderPlugin());
  createApp({}).use(pinia);
  setActivePinia(pinia);
});
afterEach(() => {
  vi.restoreAllMocks();
  disposePinia(pinia);
});

async function pendingRestore(kind: 'own' | 'legacy') {
  useImageStatsStore().stats.parent = {
    scalarMin: 0,
    scalarMax: 1,
    autoRangeValues: {},
  };
  const image = await seatImage('parent', {
    dimensions: [2, 1, 1],
    values: new Uint8Array([1, 0]),
  });
  const ids = ['deleted', 'healthy'];
  const manifest = ManifestSchema.parse(
    manifestForImages(['parent'], {
      segments: ids.map((id) => ({
        id,
        name: id,
        color: [255, 0, 0, 255],
        visible: true,
        locked: false,
      })),
      segmentations: [
        {
          id: 'segmentation',
          name: 'CT',
          parentImage: 'parent',
          fillOpacity: 1,
          outlineOpacity: 1,
          outlineThickness: 2,
          order: ids,
          masks: ids.map((id) => ({
            id,
            segmentId: id,
            representations: {
              labelmap:
                kind === 'own'
                  ? { path: `${id}.vti`, extent: [0, 1, 0, 0, 0, 0], name: id }
                  : {
                      artifactId: id,
                      sourceValue: 1,
                      extent: [0, -1, 0, -1, 0, -1],
                    },
            },
          })),
        },
      ],
      segmentationArtifacts:
        kind === 'legacy'
          ? ids.map((id) => ({
              id,
              name: id,
              path: `${id}.vti`,
              parentImage: 'parent',
            }))
          : [],
      tools: {
        rulers: {
          tools: [...ids, 'unmapped'].map((segmentId) => ({
            imageID: 'parent',
            segmentId,
            slice: 0,
            frameOfReference: {
              planeOrigin: [0, 0, 0],
              planeNormal: [0, 0, 1],
            },
            firstPoint: [0, 0, 0],
            secondPoint: [1, 0, 0],
          })),
        },
      },
    })
  );
  const reading = defer<void>();
  const release = defer<void>();
  const deserialize = store().deserialize;
  vi.spyOn(store(), 'deserialize').mockImplementation((options) =>
    deserialize({
      ...options,
      io: {
        write: async () => '',
        read: async () => {
          reading.resolve();
          await release.promise;
          return { image };
        },
      },
    })
  );
  const completed = completeStateFileRestore(
    manifest,
    ids.map((id) => ({
      archivePath: `${id}.vti`,
      file: new File([], `${id}.vti`),
    })),
    { parent: 'parent' }
  );
  await reading.promise;
  return { completed, release, registry: useSegmentStore().segments };
}

describe.each(['own', 'legacy'] as const)(
  '%s mask restore identity lifetime',
  (kind) => {
    it.each([false, true])(
      'honors deletion during IO, same-name recreation: %s',
      async (recreate) => {
        const { completed, release, registry } = await pendingRestore(kind);
        const deleted = registry.segmentList.value.find(
          (segment) => segment.name === 'deleted'
        )!;
        const healthy = registry.segmentList.value.find(
          (segment) => segment.name === 'healthy'
        )!;
        registry.deleteSegment(deleted.id);
        const replacement = recreate
          ? registry.addSegment({ name: deleted.name })
          : undefined;
        release.resolve();
        await completed;

        expect(registry.getSegment(deleted.id)).toBeUndefined();
        expect(registry.segmentList.value.map((segment) => segment.id)).toEqual(
          replacement ? [healthy.id, replacement] : [healthy.id]
        );
        const masks = store().imageMasks('parent');
        expect(masks.map((mask) => mask.segmentId)).toEqual([healthy.id]);
        expect(Array.from(store().maskVoxels(masks[0].id).scalars())).toContain(
          1
        );
        // A genuinely absent wire identity remains an unnamed shape. An adopted
        // identity deleted during IO must instead take its pending shape with it.
        expect(useRulerStore().rulers.map((ruler) => ruler.segmentId)).toEqual([
          healthy.id,
          '',
        ]);
      }
    );
  }
);
