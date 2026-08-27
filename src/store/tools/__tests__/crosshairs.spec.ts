import { describe, it, beforeEach, expect } from 'vitest';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import type { ViewInfo2D } from '@/src/types/views';
import type { LPSAxis } from '@/src/types/lps';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';

const SMALL: [number, number, number] = [10, 20, 30];
const LARGE: [number, number, number] = [40, 50, 60];

const seatImage = (id: string, dimensions: [number, number, number]) => {
  const image = vtkImageData.newInstance();
  image.setDimensions(...dimensions);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]),
    })
  );
  return useImageCacheStore().addVTKImageData(image, 'test', { id });
};

const viewIdFor = (axis: LPSAxis) => {
  const view = useViewStore().layoutViews.find(
    (candidate): candidate is ViewInfo2D =>
      candidate.type === '2D' && candidate.options.orientation === axis
  );
  if (!view) throw new Error(`no ${axis} view in the default layout`);
  return view.id;
};

describe('crosshairs tool store', () => {
  let imageA: string;
  let imageB: string;
  let axialA: string;
  let sagittalA: string;
  let coronalB: string;

  beforeEach(() => {
    setActivePinia(createPinia());
    imageA = seatImage('image-a', SMALL);
    imageB = seatImage('image-b', LARGE);

    const viewStore = useViewStore();
    axialA = viewIdFor('Axial');
    sagittalA = viewIdFor('Sagittal');
    coronalB = viewIdFor('Coronal');

    viewStore.setDataForView(axialA, imageA);
    viewStore.setDataForView(sagittalA, imageA);
    viewStore.setDataForView(coronalB, imageB);

    const sliceStore = useViewSliceStore();
    sliceStore.updateConfig(axialA, imageA, { slice: 5, min: 0, max: 29 });
    sliceStore.updateConfig(sagittalA, imageA, { slice: 3, min: 0, max: 9 });
    sliceStore.updateConfig(coronalB, imageB, { slice: 25, min: 0, max: 49 });
  });

  const sliceOf = (viewId: string, imageId: string) =>
    useViewSliceStore().getConfig(viewId, imageId)?.slice;

  it('slices every view showing the image the crosshair was moved in', () => {
    useCrosshairsToolStore().setPosition([2, 8, 17], axialA);

    expect(sliceOf(sagittalA, imageA)).toBe(2);
    expect(sliceOf(axialA, imageA)).toBe(17);
  });

  it('leaves views showing another image untouched', () => {
    useCrosshairsToolStore().setPosition([2, 8, 17], axialA);

    expect(sliceOf(coronalB, imageB)).toBe(25);
  });

  it('does not move any slices when the active view changes', async () => {
    const viewStore = useViewStore();
    viewStore.setActiveView(axialA);
    useCrosshairsToolStore().setPosition([2, 8, 17], axialA);

    // Clicking or scroll-scrubbing another image's view focuses it. That is
    // not a crosshair interaction and must not re-slice anything.
    viewStore.setActiveView(coronalB);
    await nextTick();

    expect(sliceOf(coronalB, imageB)).toBe(25);
    expect(sliceOf(axialA, imageA)).toBe(17);
    expect(sliceOf(sagittalA, imageA)).toBe(2);
  });

  it('slices the peers of the moved view even when another view is active', () => {
    const viewStore = useViewStore();
    viewStore.setActiveView(coronalB);

    useCrosshairsToolStore().setPosition([2, 8, 17], axialA);

    expect(sliceOf(sagittalA, imageA)).toBe(2);
    expect(sliceOf(coronalB, imageB)).toBe(25);
  });

  it('ignores views the layout has dropped', () => {
    const viewStore = useViewStore();
    const orphaned = sagittalA;

    // Replacing the slot's view leaves the old one in the store, unslotted.
    viewStore.replaceView(orphaned, {
      type: '2D',
      dataID: imageA,
      name: 'Sagittal',
      options: { orientation: 'Sagittal' },
    });
    expect(viewStore.layoutViews.map((view) => view.id)).not.toContain(
      orphaned
    );

    useCrosshairsToolStore().setPosition([2, 8, 17], axialA);

    expect(sliceOf(orphaned, imageA)).toBe(3);
  });

  it('clamps the crosshair to the image the moved view shows', () => {
    // Well outside image A, but inside image B.
    useCrosshairsToolStore().setPosition([35, 45, 55], axialA);

    expect(sliceOf(sagittalA, imageA)).toBe(9);
    expect(sliceOf(axialA, imageA)).toBe(29);
  });

  it('does nothing for a view without an image', () => {
    const viewStore = useViewStore();
    const empty = viewStore.layoutViews.find((view) => view.type === '3D')!;

    useCrosshairsToolStore().setPosition([2, 8, 17], empty.id);

    expect(sliceOf(axialA, imageA)).toBe(5);
    expect(sliceOf(coronalB, imageB)).toBe(25);
  });
});
