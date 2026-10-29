import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  inMemoryArtifactIO,
  manifestForImages,
  seatImage,
  serializeToStateFiles,
  serializeAnnotations,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useRulerStore } from '@/src/store/tools/rulers';

const legacyManifest = () =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({
        ...manifestForImages(['a', 'b']),
        version: '7.0.0',
        segments: [
          {
            id: 'shared',
            name: 'Tumor',
            color: [255, 0, 0, 255],
            visible: true,
            locked: false,
          },
        ],
        selectedSegment: 'shared',
        segmentations: ['a', 'b'].map((parentImage) => ({
          id: `seg-${parentImage}`,
          name: parentImage,
          parentImage,
          masks: [
            {
              id: `mask-${parentImage}`,
              segmentId: 'shared',
              representations: {},
            },
          ],
          order: [`mask-${parentImage}`],
        })),
        tools: {
          rulers: {
            tools: ['a', 'b'].map((imageID) => ({
              imageID,
              segmentId: 'shared',
              frameOfReference: {
                planeOrigin: [0, 0, 0],
                planeNormal: [0, 0, 1],
              },
              slice: 0,
              firstPoint: [0, 0, 0],
              secondPoint: [1, 0, 0],
            })),
          },
        },
      })
    )
  );

describe('image segment set persistence', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('restores the image set order and selection when catalog order differs', async () => {
    await seatImage('runtime');
    const manifest = ManifestSchema.parse(
      manifestForImages(['saved'], {
        segments: ['A', 'B'].map((name) => ({
          id: name.toLowerCase(),
          name,
          color: [255, 0, 0, 255],
        })),
        imageSegmentSets: [
          {
            imageId: 'saved',
            segmentIds: ['b', 'a'],
            selectedSegmentId: 'a',
          },
        ],
      })
    );
    const store = useSegmentStore();
    const { segmentIdMap } = store.deserialize(manifest, { saved: 'runtime' });
    expect(
      store.segments.segmentList('runtime').map(({ name }) => name)
    ).toEqual(['B', 'A']);
    expect(
      serializeAnnotations().imageSegmentSets?.find(
        ({ imageId }) => imageId === 'runtime'
      )?.selectedSegmentId
    ).toBe(segmentIdMap.a);
  });

  it('reports repeated catalog identities and refuses shared image membership', async () => {
    await seatImage('first');
    await seatImage('second');
    const manifest = ManifestSchema.parse(
      manifestForImages(['a', 'b'], {
        segments: [
          { id: 's1', name: 'A', color: [255, 0, 0, 255] },
          { id: 's1', name: 'Repeated A', color: [255, 0, 0, 255] },
          { id: 's2', name: 'B', color: [0, 255, 0, 255] },
        ],
        imageSegmentSets: [
          { imageId: 'a', segmentIds: ['s2', 's1', 's2'] },
          { imageId: 'b', segmentIds: ['s2'], selectedSegmentId: 's2' },
        ],
      })
    );
    const store = useSegmentStore();
    const { repeated, segmentIdMap } = store.deserialize(manifest, {
      a: 'first',
      b: 'second',
    });
    expect(repeated.map(({ name }) => name)).toEqual(['Repeated A', 'B']);
    expect(store.segments.segmentList('first').map(({ name }) => name)).toEqual(
      ['B', 'A']
    );
    const saved = serializeAnnotations();
    expect(
      saved.imageSegmentSets?.find(({ imageId }) => imageId === 'first')
        ?.segmentIds
    ).toContain(segmentIdMap.s2);
    expect(store.segments.segmentList('second')).toEqual([]);
    expect(
      saved.imageSegmentSets?.find(({ imageId }) => imageId === 'second')
    ).toEqual({ imageId: 'second', segmentIds: [] });
  });

  it('keeps legacy masks and shapes independent and preserves an emptied image set', async () => {
    await seatImage('image-a');
    await seatImage('image-b');
    await completeStateFileRestore(legacyManifest(), [], {
      a: 'image-a',
      b: 'image-b',
    });

    const registry = useSegmentStore().segments;
    const a = registry.segmentList('image-a')[0];
    const b = registry.segmentList('image-b')[0];
    expect(a.name).toBe('Tumor');
    expect(b.name).toBe('Tumor');
    expect(a.id).not.toBe(b.id);
    registry.deleteSegment(b.id);

    const manifest = manifestForImages(['image-a', 'image-b'], {
      tools: { rulers: useRulerStore().serializeTools() },
    });
    const { parsed: saved } = await serializeToStateFiles(
      manifest,
      inMemoryArtifactIO()
    );
    saved.imageSegmentSets.forEach((set: Record<string, unknown>) =>
      expect(set).not.toHaveProperty('legacySegmentIds')
    );
    expect(
      saved.imageSegmentSets.find(
        ({ imageId }: { imageId: string }) => imageId === 'image-b'
      )
    ).toEqual({ imageId: 'image-b', segmentIds: [] });
    expect(
      saved.segmentations.find(
        ({ parentImage }: { parentImage: string }) => parentImage === 'image-a'
      ).masks
    ).toHaveLength(1);
    expect(
      saved.tools.rulers.tools.map(
        ({ imageID }: { imageID: string }) => imageID
      )
    ).toEqual(['image-a']);

    setActivePinia(createPinia());
    await seatImage('restored-a');
    await seatImage('restored-b');
    await completeStateFileRestore(saved, [], {
      'image-a': 'restored-a',
      'image-b': 'restored-b',
    });

    expect(
      useSegmentStore()
        .segments.segmentList('restored-a')
        .map(({ name }) => name)
    ).toEqual(['Tumor']);
    expect(useSegmentStore().segments.segmentList('restored-b')).toEqual([]);
    expect(
      serializeAnnotations().imageSegmentSets?.find(
        ({ imageId }) => imageId === 'restored-b'
      )
    ).toEqual({ imageId: 'restored-b', segmentIds: [] });
    expect(useSegmentationStore().imageMasks('restored-a')).toHaveLength(1);
    expect(
      useRulerStore()
        .serializeTools()
        .tools.map(({ imageID }) => imageID)
    ).toEqual(['restored-a']);
  });

  it('lets an untouched legacy image borrow labels added after restore', async () => {
    const manifest = ManifestSchema.parse(
      migrateManifest(
        JSON.stringify({
          ...manifestForImages(['a', 'b']),
          version: '7.0.0',
          segments: [],
        })
      )
    );
    await seatImage('image-a');
    await seatImage('image-b');
    await completeStateFileRestore(manifest, [], {
      a: 'image-a',
      b: 'image-b',
    });
    const registry = useSegmentStore().segments;
    registry.addSegment('image-a', { name: 'Tumor' });
    await showImage('image-b');
    expect(registry.segmentList('image-b').map(({ name }) => name)).toEqual([
      'Tumor',
    ]);
  });

  it('skips a mask that names another image segment without losing valid masks', async () => {
    const manifest = legacyManifest();
    manifest.segmentations![1].masks[0].segmentId =
      manifest.imageSegmentSets![0].segmentIds[0];
    await seatImage('image-a');
    await seatImage('image-b');
    const dataIDMap = { a: 'image-a', b: 'image-b' };
    const { segmentIdMap } = useSegmentStore().deserialize(manifest, dataIDMap);
    const { skipped } = await useSegmentationStore().deserialize({
      manifest,
      dataIDMap,
      segmentIdMap,
      stateFiles: [],
      io: inMemoryArtifactIO(),
    });
    expect(skipped.map(({ reason }) => reason)).toEqual([
      'its segment belongs to another image',
    ]);
    expect(useSegmentationStore().imageMasks('image-a')).toHaveLength(1);
    expect(useSegmentationStore().imageMasks('image-b')).toHaveLength(0);
  });

  it('does not restore definitions for a dataset whose image never loaded', async () => {
    await seatImage('image-a');
    const registry = useSegmentStore();
    registry.deserialize(legacyManifest(), {
      a: 'image-a',
      b: 'missing-image',
    });
    expect(registry.segments.segmentList('image-a')).toHaveLength(1);
    expect(
      serializeAnnotations().imageSegmentSets?.map(({ imageId }) => imageId)
    ).toEqual(['image-a']);
  });
});
