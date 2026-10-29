import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStateFileRestorer } from '@/src/io/import/processors/restoreStateFile';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import {
  activateAppPinia,
  manifestForImages,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const stores = {
  rulers: useRulerStore,
  rectangles: useRectangleStore,
  polygons: usePolygonStore,
};

const shape = (imageID: string, segmentId: string, name: string) => ({
  imageID,
  segmentId,
  name,
  placing: false,
  slice: 0,
  frameOfReference: { planeOrigin: [0, 0, 0], planeNormal: [0, 0, 1] },
  firstPoint: [0, 0, 0],
  secondPoint: [1, 1, 0],
  points: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
  ],
});

describe('cross-image annotation restore notices', () => {
  beforeEach(async () => {
    activateAppPinia();
    await seatImage('a');
    await seatImage('b');
  });

  it.each(['rulers', 'rectangles', 'polygons'] as const)(
    'reports skipped %s while retaining valid annotations on both images',
    async (kind) => {
      const manifest = manifestForImages(['a', 'b'], {
        segments: [
          { id: 'a-segment', name: 'Liver', color: [255, 0, 0, 255] },
          { id: 'b-segment', name: 'Kidney', color: [0, 0, 255, 255] },
        ],
        imageSegmentSets: [
          { imageId: 'a', segmentIds: ['a-segment'] },
          { imageId: 'b', segmentIds: ['b-segment'] },
        ],
        tools: {
          [kind]: {
            tools: [
              shape('a', 'a-segment', 'Healthy A'),
              shape('b', 'b-segment', 'Healthy B'),
              shape('b', 'a-segment', 'Foreign'),
            ],
          },
        },
      });
      const addWarning = vi.fn();

      await createStateFileRestorer({ addWarning })(manifest, [], {
        a: 'a',
        b: 'b',
      });

      expect(addWarning).toHaveBeenCalledExactlyOnceWith(
        'Some scene content could not be restored',
        {
          details:
            '- annotation: Foreign (its segment belongs to another image)',
        }
      );
      expect(
        stores[kind]()
          .serializeTools()
          .tools.map(({ imageID, name }) => ({ imageID, name }))
      ).toEqual([
        { imageID: 'a', name: 'Healthy A' },
        { imageID: 'b', name: 'Healthy B' },
      ]);
    }
  );
});
