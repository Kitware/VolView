import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ACTION_TO_FUNC } from '@/src/composables/actions';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useToolStore } from '@/src/store/tools';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { Tools } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';

const seatAndView = (id: string) => {
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });
  useViewStore().setDataForAllViews(id);
};

describe('next/previous type shortcuts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useToolStore().setCurrentTool(Tools.Polygon);
  });

  // The shared registry starts empty, so there is nothing to cycle.
  it('is a no-op when the registry is empty', () => {
    seatAndView('img-1');

    expect(usePolygonStore().segments.segmentList.value).toEqual([]);
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
    expect(usePolygonStore().segments.selectedSegmentId.value).toBeFalsy();
  });

  it('is a no-op when no image is viewed', () => {
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
  });

  it('cycles through the registry the active tool reads', () => {
    seatAndView('img-1');
    const { segments } = usePolygonStore();
    const first = segments.addSegment({ name: 'Tumor' });
    const second = segments.addSegment({ name: 'Node' });

    segments.selectSegment(first);
    ACTION_TO_FUNC.incrementLabel();
    expect(segments.selectedSegmentId.value).toBe(second);

    ACTION_TO_FUNC.incrementLabel();
    expect(segments.selectedSegmentId.value).toBe(first);

    ACTION_TO_FUNC.decrementLabel();
    expect(segments.selectedSegmentId.value).toBe(second);
  });
});
