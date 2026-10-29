import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { TOOL_COLORS } from '@/src/config';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { cssColorToRGBA } from '@/src/segmentation/color';
import {
  createSegmentRegistry,
  defaultsFromConfig,
  snapshotFromDefaults,
} from '@/src/segmentation/segmentRegistry';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  inMemoryArtifactIO,
  manifestForImages,
  serializeToStateFiles,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const savedTumor = {
  id: 'saved-tumor',
  name: 'Tumor',
  color: [255, 0, 0, 255] as [number, number, number, number],
  visible: true,
  locked: false,
};

describe('image segment appearance on restore', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    { stated: {}, expected: savedTumor.color },
    { stated: { color: 'blue' }, expected: cssColorToRGBA('blue') },
  ])(
    'overlays only stated default appearance on a restored segment',
    ({ stated, expected }) => {
      const registry = createSegmentRegistry();
      registry.initializeSet(
        'image',
        snapshotFromDefaults(defaultsFromConfig({ Tumor: stated }))
      );

      registry.adopt('image', [savedTumor]);

      expect(registry.serialize()).toEqual([
        expect.objectContaining({ name: 'Tumor', color: expected }),
      ]);
    }
  );

  it('preserves unstated default colors through the saved manifest', async () => {
    useSegmentStore().replaceConfigSegments({ Tumor: {} }, []);
    const { parsed: defaults } = await serializeToStateFiles(
      manifestForImages([]),
      inMemoryArtifactIO()
    );
    expect(defaults.seedSegmentDefaults).toEqual([
      { name: 'Tumor', visible: true, locked: false },
    ]);

    setActivePinia(createPinia());
    useSegmentStore().deserialize(ManifestSchema.parse(defaults), {});
    await viewImage('destination');
    useSegmentStore().segments.adopt('destination', [savedTumor]);
    const { parsed: restored } = await serializeToStateFiles(
      manifestForImages(['destination']),
      inMemoryArtifactIO()
    );

    expect(restored.segments).toEqual([
      expect.objectContaining({ name: 'Tumor', color: savedTumor.color }),
    ]);
  });

  it('keeps a fully specified saved default color even when it equals the palette', async () => {
    const color = cssColorToRGBA(TOOL_COLORS[0]);
    useSegmentStore().deserialize(
      ManifestSchema.parse(
        manifestForImages([], {
          seedSegmentDefaults: [
            { name: 'Tumor', color, visible: true, locked: false },
          ],
        })
      ),
      {}
    );
    await viewImage('destination');
    useSegmentStore().segments.adopt('destination', [savedTumor]);
    const { parsed } = await serializeToStateFiles(
      manifestForImages(['destination']),
      inMemoryArtifactIO()
    );

    expect(parsed.segments).toEqual([
      expect.objectContaining({ name: 'Tumor', color }),
    ]);
  });

  it('copies the source next color after earlier rows have been deleted', async () => {
    await viewImage('source');
    const registry = useSegmentStore().segments;
    const removed = registry.mintSegment('source', { name: 'First' });
    registry.mintSegment('source', { name: 'Remaining' });
    registry.deleteSegment(removed);
    await viewImage('destination');

    registry.addSegment('source');
    registry.addSegment('destination');
    const { parsed } = await serializeToStateFiles(
      manifestForImages(['source', 'destination']),
      inMemoryArtifactIO()
    );
    const colors = parsed.imageSegmentSets.map(
      (set: { segmentIds: string[] }) =>
        set.segmentIds.map(
          (id) =>
            parsed.segments.find((segment: { id: string }) => segment.id === id)
              .color
        )
    );
    expect(colors[1]).toEqual(colors[0]);
    expect(colors[1][1]).toEqual(cssColorToRGBA(TOOL_COLORS[2]));
  });

  it('restores selection over a copied first-row fallback', async () => {
    await viewImage('source');
    const registry = useSegmentStore().segments;
    registry.mintSegment('source', { name: 'Tumor' });
    registry.mintSegment('source', { name: 'Liver' });
    await viewImage('destination');

    await completeStateFileRestore(
      ManifestSchema.parse(
        manifestForImages(['saved'], {
          primarySelection: 'saved',
          segments: [
            savedTumor,
            { ...savedTumor, id: 'saved-liver', name: 'Liver' },
          ],
          imageSegmentSets: [
            {
              imageId: 'saved',
              segmentIds: ['saved-tumor', 'saved-liver'],
              selectedSegmentId: 'saved-liver',
            },
          ],
        })
      ),
      [],
      { saved: 'destination' }
    );
    const { parsed } = await serializeToStateFiles(
      manifestForImages(['source', 'destination']),
      inMemoryArtifactIO()
    );
    const destination = parsed.imageSegmentSets.find(
      (set: { imageId: string }) => set.imageId === 'destination'
    );
    expect(
      parsed.segments.find(
        (segment: { id: string }) =>
          segment.id === destination.selectedSegmentId
      )
    ).toMatchObject({ name: 'Liver' });
  });
});
