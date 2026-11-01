import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';

const IMAGE_ID = 'img-1';

describe.each([
  ['ruler', useRulerStore],
  ['rectangle', useRectangleStore],
  ['polygon', usePolygonStore],
] as const)('%s placement order', (_name, useStore) => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id: IMAGE_ID,
    });
    useViewStore().setDataForAllViews(IMAGE_ID);
  });

  it('lists and saves finished tools in placement order, excluding unfinished tools', () => {
    const store = useStore();
    const existing = store.addTool({ imageID: IMAGE_ID });
    // each view creates its placing tool up front
    const lowerLeft = store.addTool({ imageID: IMAGE_ID, placing: true });
    const upperLeft = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.addTool({ imageID: IMAGE_ID, placing: true });

    store.placeTool(upperLeft);
    store.placeTool(lowerLeft);

    const expected = [existing, upperLeft, lowerLeft];
    expect(store.finishedTools.map((tool) => tool.id)).toEqual(expected);
    expect(store.serializeTools().tools.map((tool) => tool.id)).toEqual(
      expected
    );
  });
});
