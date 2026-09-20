import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useSegmentShapes } from '@/src/segmentation/composables/useSegmentShapes';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { AXIAL_FRAME_OF_REFERENCE } from '@/src/utils/frameOfReference';

const seat = (id: string) =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });

describe('segment shapes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seat('img-1');
    seat('img-2');
    useViewStore().setDataForAllViews('img-1');
  });

  it('groups the viewed image’s finished shapes under their segments', () => {
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
