import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { defaultImageMetadata } from '@/src/core/progressiveImage';
import { getLPSDirections } from '@/src/utils/lps';
import { slicePlane } from '@/src/referenceLines';
import { enFaceSliceLine } from '@/src/oct/sliceGeometry';
import { useEnFaceSliceLines } from '@/src/oct/useEnFaceSliceLines';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import type { ViewInfo2D } from '@/src/types/views';

function metadata(rotated = false) {
  const image = vtkImageData.newInstance();
  image.setDimensions(10, 20, 30);
  image.setSpacing([0.04, 0.01, 0.2]);
  image.setOrigin([10, -8, 20]);
  if (rotated) {
    const angle = 0.4;
    image.setDirection([
      Math.cos(angle),
      Math.sin(angle),
      0,
      -Math.sin(angle),
      Math.cos(angle),
      0,
      0,
      0,
      1,
    ]);
  }
  return {
    ...defaultImageMetadata(),
    dimensions: image.getDimensions(),
    worldToIndex: image.getWorldToIndex(),
    indexToWorld: image.getIndexToWorld(),
    lpsOrientation: getLPSDirections(image.getDirection()),
  };
}

describe('En face world slice-plane projection', () => {
  it.each([false, true])(
    'maps original B-scan positions to correct pixel centers (rotated=%s)',
    (rotated) => {
      const grid = metadata(rotated);
      const plane = slicePlane('Axial', 7, grid);
      const line = enFaceSliceLine(1, 9, plane, grid)!;
      expect(line.y1).toBeCloseTo(7.5, 4);
      expect(line.y2).toBeCloseTo(7.5, 4);
      expect([line.x1, line.x2].sort((a, b) => a - b)[0]).toBeCloseTo(0, 4);
      expect([line.x1, line.x2].sort((a, b) => a - b)[1]).toBeCloseTo(10, 4);
    }
  );
  it('maps remaining axes consistently when changing the A-line axis', () => {
    const grid = metadata();
    const alongX = enFaceSliceLine(0, 4, slicePlane('Coronal', 8, grid), grid)!;
    expect(alongX.x1).toBeCloseTo(8.5, 4);
    expect(alongX.x2).toBeCloseTo(8.5, 4);
    const alongZ = enFaceSliceLine(
      2,
      4,
      slicePlane('Sagittal', 3, grid),
      grid
    )!;
    expect(alongZ.x1).toBeCloseTo(3.5, 4);
    expect(alongZ.x2).toBeCloseTo(3.5, 4);
  });
  it('omits parallel and out-of-volume planes', () => {
    const grid = metadata();
    expect(
      enFaceSliceLine(1, 9, slicePlane('Coronal', 9, grid), grid)
    ).toBeNull();
    expect(
      enFaceSliceLine(1, 9, slicePlane('Axial', 35, grid), grid)
    ).toBeNull();
  });
});

describe('En face visible source slice linking', () => {
  beforeEach(() => setActivePinia(createPinia()));
  async function setup() {
    const image = vtkImageData.newInstance();
    image.setDimensions(10, 20, 30);
    image
      .getPointData()
      .setScalars(vtkDataArray.newInstance({ values: new Uint8Array(6000) }));
    useImageCacheStore().addVTKImageData(image, 'OCT', { id: 'oct' });
    const views = useViewStore();
    views.setDataForAllViews('oct');
    const previousHost = views.layoutViews.find((view) => view.type === '3D')!;
    views.replaceView(previousHost.id, {
      name: 'En face',
      type: 'EnFace',
      dataID: 'oct',
      options: {},
    });
    const host = views.layoutViews.find((view) => view.type === 'EnFace')!;
    const axial = views.layoutViews.find(
      (view): view is ViewInfo2D =>
        view.type === '2D' && view.options.orientation === 'Axial'
    )!;
    const lines = useEnFaceSliceLines(ref(host.id), ref('oct'), ref(1), ref(9));
    await nextTick();
    return { views, host, axial, lines };
  }
  it('tracks actual source per-view slice configuration during scrubbing', async () => {
    const { host, axial, lines } = await setup();
    useViewSliceStore().updateConfig(axial.id, 'oct', {
      slice: 5,
      min: 0,
      max: 29,
    });
    expect(
      lines.value.find((line) => line.viewId === axial.id)?.y1
    ).toBeCloseTo(5.5);
    useViewSliceStore().updateConfig(axial.id, 'oct', { slice: 12 });
    expect(
      lines.value.find((line) => line.viewId === axial.id)?.y1
    ).toBeCloseTo(12.5);
    expect(lines.value.every((line) => line.viewId !== host.id)).toBe(true);
  });
  it('excludes hidden, removed, and unrelated source views', async () => {
    const { views, host, axial, lines } = await setup();
    views.setDataForView(axial.id, 'other-image');
    expect(lines.value.some((line) => line.viewId === axial.id)).toBe(false);
    views.setActiveView(host.id);
    views.toggleActiveViewMaximized();
    expect(lines.value).toEqual([]);
  });
});
