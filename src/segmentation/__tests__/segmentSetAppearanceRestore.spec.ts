import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { TOOL_COLORS } from '@/src/config';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { cssColorToRGBA } from '@/src/segmentation/color';
import { createSegmentRegistry } from '@/src/segmentation/segmentRegistry';
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
    'overlays only stated config appearance on a restored segment',
    ({ stated, expected }) => {
      const registry = createSegmentRegistry();
      registry.adopt('image', [savedTumor]);

      registry.applyConfig({ Tumor: stated });

      expect(registry.segmentList('image')).toEqual([
        expect.objectContaining({ name: 'Tumor', color: expected }),
      ]);
    }
  );

  it('starts a new image at the first palette color whatever the source used', async () => {
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
    const colors = parsed.imageSegments.map(
      ({ segments }: { segments: Array<{ color: number[] }> }) =>
        segments.map(({ color }) => color)
    );
    expect(colors[0][1]).toEqual(cssColorToRGBA(TOOL_COLORS[2]));
    expect(colors[1]).toEqual([cssColorToRGBA(TOOL_COLORS[0])]);
  });

  it('restores the saved selection over the first-row fallback', async () => {
    await viewImage('source');
    const registry = useSegmentStore().segments;
    registry.mintSegment('source', { name: 'Tumor' });
    registry.mintSegment('source', { name: 'Liver' });
    await viewImage('destination');

    await completeStateFileRestore(
      ManifestSchema.parse(
        manifestForImages(['saved'], {
          primarySelection: 'saved',
          imageSegments: [
            {
              imageId: 'saved',
              selectedSegmentId: 'saved-liver',
              segments: [
                savedTumor,
                { ...savedTumor, id: 'saved-liver', name: 'Liver' },
              ],
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
    const destination = parsed.imageSegments.find(
      (set: { imageId: string }) => set.imageId === 'destination'
    );
    expect(
      destination.segments.find(
        (segment: { id: string }) =>
          segment.id === destination.selectedSegmentId
      )
    ).toMatchObject({ name: 'Liver' });
  });
});
