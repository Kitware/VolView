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

describe('next/previous label shortcuts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useToolStore().setCurrentTool(Tools.Polygon);
  });

  // Shared-registry tools have no segments until one is created.
  it('is a no-op when the active tool has no labels', () => {
    seatAndView('img-1');

    expect(usePolygonStore().labels).toEqual({});
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
    expect(usePolygonStore().activeLabel).toBeFalsy();
  });

  it('is a no-op when no image is viewed', () => {
    expect(() => ACTION_TO_FUNC.incrementLabel()).not.toThrow();
    expect(() => ACTION_TO_FUNC.decrementLabel()).not.toThrow();
  });

  it('cycles through the labels the active tool has', () => {
    seatAndView('img-1');
    const store = usePolygonStore();
    const first = store.addLabel({ labelName: 'Tumor' });
    const second = store.addLabel({ labelName: 'Node' });

    store.setActiveLabel(first);
    ACTION_TO_FUNC.incrementLabel();
    expect(store.activeLabel).toBe(second);

    ACTION_TO_FUNC.incrementLabel();
    expect(store.activeLabel).toBe(first);

    ACTION_TO_FUNC.decrementLabel();
    expect(store.activeLabel).toBe(second);
  });
});
