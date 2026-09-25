import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSegmentShapes } from '@/src/segmentation/composables/useSegmentShapes';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  seatImage,
  viewImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

describe('segment shapes', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-2');
    await viewImage('img-1');
  });

  it("groups the viewed image's finished shapes under their segments", () => {
    const { segments } = useSegmentStore();
    const tumor = segments.mintSegment({ name: 'Tumor' });
    const node = segments.mintSegment({ name: 'Node' });
    const placed = { frameOfReference: AXIAL_FRAME_OF_REFERENCE, slice: 2 };
    const ruler = useRulerStore().addTool({
      ...placed,
      imageID: 'img-1',
      segmentId: tumor,
      firstPoint: [0, 0, 0],
      secondPoint: [3, 4, 0],
    });
    const rectangle = useRectangleStore().addTool({
      ...placed,
      imageID: 'img-1',
      segmentId: node,
    });
    useRulerStore().addTool({ ...placed, imageID: 'img-2', segmentId: tumor });
    useRulerStore().addTool({
      ...placed,
      imageID: 'img-1',
      segmentId: node,
      placing: true,
    });

    const { shapesOf } = useSegmentShapes();
    const listed = (segmentId: string) =>
      shapesOf(segmentId).map(({ id, placement, measurement }) => ({
        id,
        placement,
        measurement,
      }));

    expect(listed(tumor)).toEqual([
      { id: ruler, placement: 'Axial 3', measurement: '5.00mm' },
    ]);
    expect(listed(node)).toEqual([
      { id: rectangle, placement: 'Axial 3', measurement: '' },
    ]);
  });
});
