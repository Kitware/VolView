import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  inMemoryArtifactIO,
  manifestForImages,
  savedSegmentNames,
  seatImage,
  serializeToStateFiles,
  serializeAnnotations,
  showImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useRulerStore } from '@/src/store/tools/rulers';
import { DEFAULT_SEGMENTATION_DISPLAY } from '@/src/segmentation/model';

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
    ).manifest
  );

describe('image segment set persistence', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('restores the saved order and selection', async () => {
    await seatImage('runtime');
    const manifest = ManifestSchema.parse(
      manifestForImages(['saved'], {
        imageSegments: [
          {
            imageId: 'saved',
            selectedSegmentId: 'a',
            segments: ['B', 'A'].map((name) => ({
              id: name.toLowerCase(),
              name,
              color: [255, 0, 0, 255],
            })),
          },
        ],
      })
    );
    const resolve = useSegmentStore().deserialize(manifest, {
      saved: 'runtime',
    });
    expect(savedSegmentNames('runtime')).toEqual(['B', 'A']);
    expect(
      serializeAnnotations().imageSegments?.find(
        ({ imageId }) => imageId === 'runtime'
      )?.selectedSegmentId
    ).toBe(resolve('runtime', 'a'));
  });

  it('scopes saved ids to their image and seats a repeated id once', async () => {
    await seatImage('first');
    await seatImage('second');
    const segment = (id: string, name: string) => ({
      id,
      name,
      color: [255, 0, 0, 255],
    });
    const manifest = ManifestSchema.parse(
      manifestForImages(['a', 'b'], {
        imageSegments: [
          {
            imageId: 'a',
            segments: [
              segment('s2', 'B'),
              segment('s1', 'A'),
              segment('s2', 'Repeated B'),
            ],
          },
          { imageId: 'b', segments: [segment('s2', 'B')] },
        ],
      })
    );
    const resolve = useSegmentStore().deserialize(manifest, {
      a: 'first',
      b: 'second',
    });
    expect(savedSegmentNames('first')).toEqual(['B', 'A']);
    expect(savedSegmentNames('second')).toEqual(['B']);
    expect(resolve('first', 's2')).not.toBe(resolve('second', 's2'));
    expect(resolve('second', 's1')).toBeUndefined();
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
    expect(
      saved.imageSegments.find(
        ({ imageId }: { imageId: string }) => imageId === 'image-b'
      )
    ).toEqual({
      imageId: 'image-b',
      segments: [],
      display: DEFAULT_SEGMENTATION_DISPLAY,
    });
    // A legacy mask without a labelmap restores no mask, so none is saved.
    expect(
      saved.imageSegments.flatMap(({ segments }: any) =>
        segments.filter(({ labelmap }: any) => labelmap)
      )
    ).toEqual([]);
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

    expect(savedSegmentNames('restored-a')).toEqual(['Tumor']);
    expect(
      serializeAnnotations().imageSegments?.find(
        ({ imageId }) => imageId === 'restored-b'
      )
    ).toEqual({
      imageId: 'restored-b',
      segments: [],
      display: DEFAULT_SEGMENTATION_DISPLAY,
    });
    expect(useSegmentationStore().imageMasks('restored-a')).toEqual([]);
    expect(
      useRulerStore()
        .serializeTools()
        .tools.map(({ imageID }) => imageID)
    ).toEqual(['restored-a']);
  });

  it('keeps a legacy image without a saved set empty when another image gains labels', async () => {
    const manifest = ManifestSchema.parse(
      migrateManifest(
        JSON.stringify({
          ...manifestForImages(['a', 'b']),
          version: '7.0.0',
          segments: [],
        })
      ).manifest
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
    expect(savedSegmentNames('image-b')).toEqual([]);
  });

  it('does not restore definitions for a dataset whose image never loaded', async () => {
    await seatImage('image-a');
    const registry = useSegmentStore();
    registry.deserialize(legacyManifest(), {
      a: 'image-a',
      b: 'missing-image',
    });
    expect(savedSegmentNames('image-a')).toEqual(['Tumor']);
    expect(
      serializeAnnotations().imageSegments?.map(({ imageId }) => imageId)
    ).toEqual(['image-a']);
  });
});
