import { describe, it, beforeEach, expect } from 'vitest';
import { ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import type { ViewInfo2D } from '@/src/types/views';
import type { LPSAxis } from '@/src/types/lps';
import { useReferenceLines } from '../useReferenceLines';

const DIMS: [number, number, number] = [10, 20, 30];

const seatImage = (id: string) => {
  const image = vtkImageData.newInstance();
  image.setDimensions(...DIMS);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(DIMS[0] * DIMS[1] * DIMS[2]),
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

describe('useReferenceLines', () => {
  let imageID: string;

  beforeEach(() => {
    setActivePinia(createPinia());
    imageID = seatImage('image-1');
    useViewStore().setDataForAllViews(imageID);
  });

  it('draws one line per crossing peer view', () => {
    const sliceStore = useViewSliceStore();
    const axial = viewIdFor('Axial');
    const sagittal = viewIdFor('Sagittal');
    const coronal = viewIdFor('Coronal');

    sliceStore.updateConfig(axial, imageID, { slice: 5, min: 0, max: 29 });
    sliceStore.updateConfig(sagittal, imageID, { slice: 3, min: 0, max: 9 });
    sliceStore.updateConfig(coronal, imageID, { slice: 8, min: 0, max: 19 });

    const lines = useReferenceLines(ref(axial), ref(imageID));

    expect(lines.value.map((entry) => entry.viewId).sort()).toEqual(
      [coronal, sagittal].sort()
    );

    const sagittalLine = lines.value.find(
      (entry) => entry.viewId === sagittal
    )!;
    // x = 3, z = 5, spanning the inflated j extent
    expect(sagittalLine.line.p1).toAlmostEqual([3, -0.5, 5]);
    expect(sagittalLine.line.p2).toAlmostEqual([3, 19.5, 5]);
  });

  it('follows a peer slice change', () => {
    const sliceStore = useViewSliceStore();
    const axial = viewIdFor('Axial');
    const sagittal = viewIdFor('Sagittal');

    sliceStore.updateConfig(axial, imageID, { slice: 5, min: 0, max: 29 });
    sliceStore.updateConfig(sagittal, imageID, { slice: 3, min: 0, max: 9 });

    const lines = useReferenceLines(ref(axial), ref(imageID));
    const first = lines.value.find((entry) => entry.viewId === sagittal)!;
    expect(first.line.p1[0]).toAlmostEqual(3);

    sliceStore.updateConfig(sagittal, imageID, { slice: 7 });

    const second = lines.value.find((entry) => entry.viewId === sagittal)!;
    expect(second.line.p1[0]).toAlmostEqual(7);
  });

  it('draws a line for each of two views on the same axis', () => {
    const viewStore = useViewStore();
    const sliceStore = useViewSliceStore();
    const sagittal = viewIdFor('Sagittal');
    const coronal = viewIdFor('Coronal');

    // Make the coronal slot a second axial view at a different slice.
    viewStore.replaceView(coronal, {
      type: '2D',
      dataID: imageID,
      name: 'Axial',
      options: { orientation: 'Axial' },
    });

    const axialViews = viewStore.layoutViews.filter(
      (view): view is ViewInfo2D =>
        view.type === '2D' && view.options.orientation === 'Axial'
    );
    expect(axialViews).toHaveLength(2);
    axialViews.forEach((view, index) => {
      sliceStore.updateConfig(view.id, imageID, {
        slice: 4 + index * 10,
        min: 0,
        max: 29,
      });
    });
    sliceStore.updateConfig(sagittal, imageID, { slice: 2, min: 0, max: 9 });

    const sagittalLines = useReferenceLines(ref(sagittal), ref(imageID));
    expect(sagittalLines.value).toHaveLength(2);
    expect(
      sagittalLines.value.map((entry) => entry.line.p1[2]).sort((a, b) => a - b)
    ).toAlmostEqual([4, 14]);

    // The two axial views draw nothing for each other: parallel planes.
    const axialLines = useReferenceLines(ref(axialViews[0].id), ref(imageID));
    expect(axialLines.value.map((entry) => entry.viewId)).toEqual([sagittal]);
  });

  it('returns nothing when the host view is not a slicing view', () => {
    const volumeView = useViewStore().layoutViews.find(
      (view) => view.type === '3D'
    )!;

    const lines = useReferenceLines(ref(volumeView.id), ref(imageID));

    expect(lines.value).toEqual([]);
  });

  it('returns nothing without an image', () => {
    const lines = useReferenceLines(ref(viewIdFor('Axial')), ref(null));

    expect(lines.value).toEqual([]);
  });
});
