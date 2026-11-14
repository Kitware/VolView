import { beforeEach, describe, expect, it } from 'vitest';

import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useViewStore } from '@/src/store/views';
import {
  activateAppPinia,
  seatImage,
  maskValueAt,
  serializeAnnotations,
  strokeAt,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const showInactiveImage = async (imageId: string) => {
  await seatImage(imageId);
  const views = useViewStore();
  const viewId = views.viewIDs.find((id) => id !== views.activeView)!;
  views.setDataForView(viewId, imageId);
  return () => views.setActiveView(viewId);
};

const paintedSegmentColor = (imageId: string) => {
  const [painted] = useSegmentationStore().imageMasks(imageId);
  expect(maskValueAt(painted.id, [1, 1, 0])).toBe(SEGMENT_VALUE);
  return serializeAnnotations().segments?.find(
    ({ id }) => id === painted.segmentId
  )?.color;
};

describe('the next painted segment color', () => {
  beforeEach(activateAppPinia);

  it("previews an inactive image's copied selection without initializing it", async () => {
    await viewImage('source');
    const store = useSegmentStore();
    store.segments.addSegment('source', { name: 'First' });
    store.segments.addSegment('source', {
      name: 'Selected',
      color: [11, 22, 33, 255],
    });
    const activate = await showInactiveImage('destination');

    const preview = store.previewSegmentColor('destination');

    expect(
      serializeAnnotations().imageSegmentSets?.some(
        ({ imageId }) => imageId === 'destination'
      )
    ).toBe(false);
    activate();
    strokeAt('destination', [1, 1, 0]);
    expect(paintedSegmentColor('destination')).toEqual(preview);
    expect(preview).toEqual([11, 22, 33, 255]);
  });

  it("previews an inherited empty set's next color after earlier rows were deleted", async () => {
    await viewImage('source');
    const store = useSegmentStore();
    const deleted = store.segments.addSegment('source');
    store.segments.deleteSegment(deleted);
    const activate = await showInactiveImage('destination');

    const preview = store.previewSegmentColor('destination');
    activate();
    strokeAt('destination', [1, 1, 0]);

    expect(paintedSegmentColor('destination')).toEqual(preview);
  });

  it('previews configured defaults before the first image is activated', async () => {
    const store = useSegmentStore();
    store.replaceConfigSegments({ Configured: { color: '#102030' } });
    const activate = await showInactiveImage('destination');

    const preview = store.previewSegmentColor('destination');
    activate();
    strokeAt('destination', [1, 1, 0]);

    expect(paintedSegmentColor('destination')).toEqual(preview);
    expect(preview).toEqual([16, 32, 48, 255]);
  });
});
