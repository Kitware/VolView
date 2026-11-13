import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { LPSAxis } from '@/src/types/lps';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import { viewedSlice } from '@/src/store/dicom-viewed-slice';

function cacheStack(slices: number) {
  const data = vtkImageData.newInstance();
  data.setDimensions([2, 2, slices]);
  data
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ values: new Uint8Array(4 * slices) })
    );
  return useImageCacheStore().addVTKImageData(data, 'stack');
}

function show(dataID: string, orientation: LPSAxis, slot = 0) {
  const views = useViewStore();
  views.replaceView(views.layoutViews[slot].id, {
    name: orientation,
    type: '2D',
    dataID,
    options: { orientation },
  });
  return views.layoutViews[slot].id;
}

describe('viewedSlice', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('follows the slice a view along the acquisition axis shows', () => {
    const id = cacheStack(9);
    const viewID = show(id, 'Axial');
    useViewStore().setActiveView(viewID);

    useViewSliceStore().updateConfig(viewID, id, { min: 0, max: 8, slice: 6 });
    expect(viewedSlice(id)).toBe(6);

    useViewSliceStore().updateConfig(viewID, id, { slice: 2 });
    expect(viewedSlice(id)).toBe(2);
  });

  it('ignores views that cut across the acquisition axis', () => {
    const id = cacheStack(9);
    const viewID = show(id, 'Sagittal');
    useViewSliceStore().updateConfig(viewID, id, { min: 0, max: 1, slice: 1 });

    expect(viewedSlice(id)).toBeUndefined();
  });

  it('prefers the active view when two views show different slices', () => {
    const id = cacheStack(9);
    const [first, second] = [show(id, 'Axial', 0), show(id, 'Axial', 1)];
    const slices = useViewSliceStore();
    slices.updateConfig(first, id, { min: 0, max: 8, slice: 1 });
    slices.updateConfig(second, id, { min: 0, max: 8, slice: 7 });

    useViewStore().setActiveView(second);

    expect(viewedSlice(id)).toBe(7);
  });
});
