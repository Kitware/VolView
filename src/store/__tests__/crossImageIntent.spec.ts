import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { resolveRasterizeTarget } from '@/src/components/tools/polygon/rasterizeTarget';

// ---------------------------------------------------------------------------
// The active segment is an intent: editing another image clones that segment's
// identity onto the other image rather than writing into it. The intent holds a
// reference to the segment it came from, not a snapshot of its name and color,
// so a rename or a recolor after selection carries across.
//
// Cross-image P1, decided in C3: option 1 stands. An annotation placed on
// another image while a segment of the first is active lands unlabeled; the
// clone is minted when the edit happens, not when the annotation is placed.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const makeSegment = (imageId: string, name: string) => {
  const segmentation = store().ensureSegmentationForImage(imageId);
  return store().createSegment(segmentation.id, { name });
};

const segmentIdsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

describe('cross-image intent follows the origin segment', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
  });

  it('clones the origin segment’s current name, not the name it had when selected', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);

    store().updateSegment(origin.id, { name: 'Lesion' });
    const cloned = store().resolveEditTarget('img-2');

    expect(store().getSegment(cloned).name).toBe('Lesion');
  });

  it('clones the origin segment’s current color, not the color it had when selected', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);

    store().updateSegment(origin.id, { color: [10, 20, 30, 255] });
    const cloned = store().resolveEditTarget('img-2');

    expect(store().getSegment(cloned).color).toEqual([10, 20, 30, 255]);
  });

  it('clones onto the other image rather than editing the origin', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);

    const cloned = store().resolveEditTarget('img-2');

    expect(cloned).not.toBe(origin.id);
    expect(segmentIdsOf('img-1')).toEqual([origin.id]);
    expect(segmentIdsOf('img-2')).toEqual([cloned]);
  });

  it('reuses the clone on a second edit of the same image', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);

    const first = store().resolveEditTarget('img-2');
    const second = store().resolveEditTarget('img-2');

    expect(second).toBe(first);
    expect(segmentIdsOf('img-2')).toEqual([first]);
  });

  it('falls back to the default identity when the origin segment is gone', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);
    store().deleteSegment(origin.id);

    const cloned = store().resolveEditTarget('img-2');

    expect(store().getSegment(cloned).name).toBe('Segment 1');
  });

  it('keeps the clone independent once it exists', () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);
    const cloned = store().resolveEditTarget('img-2');

    store().updateSegment(origin.id, { name: 'Lesion' });

    expect(store().getSegment(cloned).name).toBe('Tumor');
  });

  it('takes a reselected segment as the new origin', () => {
    const first = makeSegment('img-1', 'Tumor');
    const second = makeSegment('img-1', 'Node');
    store().setActiveSegment(first.id);
    store().setActiveSegment(second.id);
    store().updateSegment(second.id, { name: 'Renamed node' });

    const cloned = store().resolveEditTarget('img-2');

    expect(store().getSegment(cloned).name).toBe('Renamed node');
  });
});

describe('placing and rasterizing on another image', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
    await seatImage('img-2');
    await viewImage('img-1');
  });

  // Option 1: the label picker is scoped to the viewed image, so a segment of
  // another image cannot label an annotation placed here.
  it('leaves an annotation placed on another image unlabeled', async () => {
    const origin = makeSegment('img-1', 'Tumor');
    const polygons = usePolygonStore();
    polygons.setActiveLabel(origin.id);

    await viewImage('img-2');
    const toolId = polygons.addTool({ imageID: 'img-2', placing: false });

    expect(polygons.activeLabel).toBeUndefined();
    expect(polygons.toolByID[toolId].label).toBeFalsy();
    // The store-level intent is untouched: only the picker is image-scoped.
    expect(store().activeSegmentId).toBe(origin.id);
  });

  // Option 1's other half: the intent resolves at rasterize time, so the voxels
  // land in a segment of the viewed image carrying the origin's live identity.
  it('rasterizes an unlabeled annotation into a clone on the viewed image', async () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);
    store().updateSegment(origin.id, { name: 'Lesion' });

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(store().getSegment(target.segmentId).name).toBe('Lesion');
    expect(segmentIdsOf('img-2')).toEqual([target.segmentId]);
    expect(segmentIdsOf('img-1')).toEqual([origin.id]);
  });

  it('never rasterizes into the other image’s segment', async () => {
    const origin = makeSegment('img-1', 'Tumor');
    store().setActiveSegment(origin.id);
    store().ensureLabelmapBinding(origin.id);

    await viewImage('img-2');
    const target = resolveRasterizeTarget('img-2', '')!;

    expect(target.segmentId).not.toBe(origin.id);
    expect(target.artifactId).not.toBe(
      store().getSegment(origin.id).representations.labelmap!.artifactId
    );
  });
});
