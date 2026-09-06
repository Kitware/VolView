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

    expect(usePolygonStore().types.typeList.value).toEqual([]);
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
    expect(usePolygonStore().types.selectedTypeId.value).toBeFalsy();
  });

  it('is a no-op when no image is viewed', () => {
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
  });

  it('cycles through the registry the active tool reads', () => {
    seatAndView('img-1');
    const { types } = usePolygonStore();
    const first = types.addType({ name: 'Tumor' });
    const second = types.addType({ name: 'Node' });

    types.selectType(first);
    ACTION_TO_FUNC.incrementLabel();
    expect(types.selectedTypeId.value).toBe(second);

    ACTION_TO_FUNC.incrementLabel();
    expect(types.selectedTypeId.value).toBe(first);

    ACTION_TO_FUNC.decrementLabel();
    expect(types.selectedTypeId.value).toBe(second);
  });
});
