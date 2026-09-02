import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';

import { useImageCacheStore } from '@/src/store/image-cache';
import { listSegments } from '@/src/types/segmentation';
import {
  addSegment,
  extentOf,
  labelValueOf,
  maskValueAt,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  voxelCount,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// The two directions between N bounded masks and one parent-shaped labelmap.
//
// COMPOSE is what leaves VolView: the save dialog's own codec call and the job
// staging both hand a labelmap to `writeSegmentation`, and a single segment's
// bounded mask is not what either of them means. It is built on demand, never
// stored: storage stays N masks.
//
// SPLIT is what arrives: an imported labelmap carries every segment in one
// buffer, and each label value becomes a segment with a mask cropped to the
// voxels that value actually occupies.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

const parentOffset = (i: number, j: number, k: number) =>
  i + j * DIMENSIONS[0] + k * DIMENSIONS[0] * DIMENSIONS[1];

const compositeScalars = (imageId: string) =>
  store()
    .compositeLabelmap(imageId)
    .labelmap.getPointData()
    .getScalars()
    .getData() as TypedArray;

const segmentIdsOf = (imageId: string) =>
  listSegments(store().getSegmentationForImage(imageId)!).map(
    (segment) => segment.id
  );

/** A child image in the parent's space, carrying one value per named voxel. */
function makeLabelmapImage(marks: Array<{ value: number; at: Index3 }>) {
  const image = vtkImageData.newInstance({
    spacing: [2, 3, 4],
    origin: [10, 20, 30],
  });
  image.setDimensions(DIMENSIONS);
  const values = new Uint8Array(voxelCount(DIMENSIONS));
  marks.forEach(({ value, at }) => {
    values[parentOffset(...at)] = value;
  });
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  return image;
}

const GRID = {
  dimensions: DIMENSIONS,
  spacing: [2, 3, 4] as [number, number, number],
  origin: [10, 20, 30] as [number, number, number],
};

describe('composing the segments of an image into one labelmap', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', GRID);
  });

  it('is shaped and placed like the parent image', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const { labelmap } = store().compositeLabelmap('img-1');

    const parent = parentImage('img-1');
    expect(labelmap.getDimensions()).toEqual(parent.getDimensions());
    expect(Array.from(labelmap.getSpacing())).toEqual(
      Array.from(parent.getSpacing())
    );
    expect(Array.from(labelmap.getOrigin())).toEqual(
      Array.from(parent.getOrigin())
    );
    expect(Array.from(labelmap.getDirection())).toEqual(
      Array.from(parent.getDirection())
    );
  });

  it('writes every segment at its own label value, at its own parent voxels', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);

    const scalars = compositeScalars('img-1');

    expect(scalars[parentOffset(1, 1, 1)]).toBe(labelValueOf(tumor));
    expect(scalars[parentOffset(3, 3, 3)]).toBe(labelValueOf(node));
  });

  it('leaves everything no segment covers at the background value', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const scalars = compositeScalars('img-1');

    expect(scalars).toHaveLength(voxelCount(DIMENSIONS));
    expect(Array.from(scalars).filter((value) => value !== 0)).toHaveLength(1);
  });

  it('gives the later segment the voxel where two overlap', () => {
    const under = addSegment('img-1', 'Under');
    const over = addSegment('img-1', 'Over');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);

    expect(compositeScalars('img-1')[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(over)
    );
  });

  it('skips a segment with no storage and one whose mask is empty', () => {
    addSegment('img-1', 'Unbound');
    const empty = addSegment('img-1', 'Empty');
    store().segmentVoxels(empty).materialize();
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const scalars = compositeScalars('img-1');

    expect(scalars[parentOffset(1, 1, 1)]).toBe(labelValueOf(tumor));
    expect(Array.from(scalars).filter((value) => value !== 0)).toHaveLength(1);
  });

  it('describes the image’s segments in order, keyed by label value', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);
    store().updateSegment(node, { visible: false });

    const { segments } = store().compositeLabelmap('img-1');

    expect(segments.map((segment) => segment.name)).toEqual(['Tumor', 'Node']);
    expect(segments[0]).toMatchObject({
      value: labelValueOf(tumor),
      visible: true,
    });
    expect(segments[1]).toMatchObject({
      value: labelValueOf(node),
      visible: false,
    });
  });

  it('composes an image with no segments to an empty labelmap', () => {
    const { labelmap, segments } = store().compositeLabelmap('img-1');

    expect(segments).toEqual([]);
    expect(labelmap.getDimensions()).toEqual(
      parentImage('img-1').getDimensions()
    );
    expect(
      Array.from(
        labelmap.getPointData().getScalars().getData() as TypedArray
      ).every((value) => value === 0)
    ).toBe(true);
  });

  it('copies the voxels out rather than aliasing the masks', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const scalars = compositeScalars('img-1');
    scalars[parentOffset(1, 1, 1)] = 0;
    scalars[parentOffset(2, 2, 2)] = 9;

    expect(maskValueAt(tumor, [1, 1, 1])).toBe(labelValueOf(tumor));
    expect(compositeScalars('img-1')[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(tumor)
    );
  });
});

describe('splitting an imported labelmap into bounded masks', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('parent-img', GRID);
  });

  const importLabelmap = async (
    marks: Array<{ value: number; at: Index3 }>
  ) => {
    useImageCacheStore().addVTKImageData(
      makeLabelmapImage(marks),
      'Tumor.seg.nrrd',
      { id: 'child-img' }
    );
    await store().convertImageToLabelmap('child-img', 'parent-img');
  };

  it('makes one segment per label value, bounded to that value’s voxels', async () => {
    await importLabelmap([
      { value: 1, at: [1, 1, 1] },
      { value: 2, at: [3, 3, 3] },
    ]);

    const [first, second] = segmentIdsOf('parent-img');
    expect(extentOf(first)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(extentOf(second)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(maskValueAt(first, [1, 1, 1])).toBe(1);
    expect(maskValueAt(second, [3, 3, 3])).toBe(2);
    expect(maskValueAt(first, [3, 3, 3])).toBeUndefined();
  });

  it('bounds a segment to the box its voxels span', async () => {
    await importLabelmap([
      { value: 1, at: [1, 0, 2] },
      { value: 1, at: [2, 3, 2] },
    ]);

    const [only] = segmentIdsOf('parent-img');
    expect(extentOf(only)).toEqual([1, 2, 0, 3, 2, 2]);
    expect(maskValueAt(only, [1, 0, 2])).toBe(1);
    expect(maskValueAt(only, [2, 3, 2])).toBe(1);
    expect(maskValueAt(only, [1, 3, 2])).toBe(0);
  });

  it('keeps each source label value and its decoded name', async () => {
    await importLabelmap([
      { value: 1, at: [1, 1, 1] },
      { value: 3, at: [3, 3, 3] },
    ]);

    const segmentation = store().getSegmentationForImage('parent-img')!;
    expect(listSegments(segmentation).map((segment) => segment.name)).toEqual([
      'Tumor 1',
      'Tumor 3',
    ]);
    expect(segmentIdsOf('parent-img').map(labelValueOf)).toEqual([1, 3]);
  });

  it('lines the split masks up with the parent grid', async () => {
    await importLabelmap([{ value: 1, at: [1, 2, 3] }]);

    const [only] = segmentIdsOf('parent-img');
    const mask = store().segmentVoxels(only).image();
    expect(Array.from(mask.indexToWorld([0, 0, 0] as never))).toEqual(
      Array.from(parentImage('parent-img').indexToWorld([1, 2, 3] as never))
    );
    expect(mask.getDimensions()).toEqual([1, 1, 1]);
  });

  it('makes no segment for an all-background labelmap', async () => {
    await importLabelmap([]);

    expect(store().getSegmentationForImage('parent-img')?.order ?? []).toEqual(
      []
    );
  });

  it('composes back to the labelmap it was imported from', async () => {
    const marks = [
      { value: 1, at: [1, 1, 1] as Index3 },
      { value: 1, at: [2, 1, 1] as Index3 },
      { value: 4, at: [3, 3, 3] as Index3 },
    ];
    await importLabelmap(marks);

    const composed = Array.from(compositeScalars('parent-img'));
    const source = Array.from(
      makeLabelmapImage(marks).getPointData().getScalars().getData()
    );
    expect(composed).toEqual(source);
  });
});

// ---------------------------------------------------------------------------
// The write-back direction: a process whose scope is every segment at once
// edits the composite, and what it produced has to land in the N bounded masks
// that own each voxel.
// ---------------------------------------------------------------------------

describe('writing a composite edit back into the bounded masks', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', GRID);
  });

  /** What a composite built after the edit reads at a parent index. */
  const compositeValueAt = (index: Index3) =>
    store().imageVoxels('img-1').scalars()[parentOffset(...index)];

  /** Two segments stacked on one voxel: the later one owns the composite. */
  const overlapAt = (index: Index3) => {
    const under = addSegment('img-1', 'Under');
    const over = addSegment('img-1', 'Over');
    seedVoxel(under, index);
    seedVoxel(over, index);
    return { under, over };
  };

  /** Writes one voxel through the image accessor the edit was read from. */
  const applyVoxel = (index: Index3, value: number) => {
    const voxels = store().imageVoxels('img-1');
    const edited = voxels.snapshot();
    edited[parentOffset(...index)] = value;
    voxels.apply(edited);
    return voxels;
  };

  it('sends each label value back to the segment that owns it', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);
    const voxels = store().imageVoxels('img-1');

    const edited = voxels.snapshot();
    edited[parentOffset(2, 2, 2)] = labelValueOf(node)!;
    voxels.apply(edited);

    expect(maskValueAt(node, [2, 2, 2])).toBe(labelValueOf(node));
    expect(maskValueAt(tumor, [2, 2, 2])).toBeUndefined();
  });

  it('grows a mask to reach a voxel the edit added outside it', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);
    expect(extentOf(tumor)).toEqual([1, 1, 1, 1, 1, 1]);
    const voxels = store().imageVoxels('img-1');

    const edited = voxels.snapshot();
    edited[parentOffset(3, 3, 3)] = labelValueOf(tumor)!;
    voxels.apply(edited);

    expect(extentOf(tumor)).toEqual([1, 3, 1, 3, 1, 3]);
    expect(maskValueAt(tumor, [3, 3, 3])).toBe(labelValueOf(tumor));
    expect(maskValueAt(tumor, [1, 1, 1])).toBe(labelValueOf(tumor));
  });

  it('clears a voxel the edit took away from its segment', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    applyVoxel([1, 1, 1], 0);

    expect(maskValueAt(tumor, [1, 1, 1])).toBe(0);
  });

  it('leaves the voxels the edit did not change alone, overlap included', () => {
    const { under, over } = overlapAt([1, 1, 1]);

    // The composite can only show the later segment there, so a write-back
    // that rewrote every voxel would erase the one underneath.
    applyVoxel([2, 2, 2], labelValueOf(over)!);

    expect(maskValueAt(under, [1, 1, 1])).toBe(labelValueOf(under));
    expect(maskValueAt(over, [1, 1, 1])).toBe(labelValueOf(over));
  });

  it('takes an overlapped voxel from every mask when the edit clears it', () => {
    const { under, over } = overlapAt([1, 1, 1]);

    const voxels = applyVoxel([1, 1, 1], 0);

    expect(maskValueAt(under, [1, 1, 1])).toBe(0);
    expect(maskValueAt(over, [1, 1, 1])).toBe(0);
    // What the accessor now reads is what a freshly composed one reads.
    expect(compositeValueAt([1, 1, 1])).toBe(0);
    expect(voxels.scalars()[parentOffset(1, 1, 1)]).toBe(0);
  });

  it('leaves a changed overlapped voxel holding only the value the edit set', () => {
    // First in the order, so the composite shows it only where nothing later
    // still holds the voxel.
    const other = addSegment('img-1', 'Other');
    seedVoxel(other, [3, 3, 3]);
    const { under, over } = overlapAt([1, 1, 1]);

    applyVoxel([1, 1, 1], labelValueOf(other)!);

    expect(maskValueAt(other, [1, 1, 1])).toBe(labelValueOf(other));
    expect(maskValueAt(under, [1, 1, 1])).toBe(0);
    expect(maskValueAt(over, [1, 1, 1])).toBe(0);
    expect(compositeValueAt([1, 1, 1])).toBe(labelValueOf(other));
  });

  it('drops a label value no segment owns', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);
    const voxels = store().imageVoxels('img-1');

    const edited = voxels.snapshot();
    edited[parentOffset(2, 2, 2)] = 200;
    voxels.apply(edited);

    expect(maskValueAt(tumor, [2, 2, 2])).toBeUndefined();
    expect(extentOf(tumor)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('refuses a buffer that is not the parent’s shape', () => {
    const tumor = addSegment('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    expect(() => store().imageVoxels('img-1').apply(new Uint8Array(3))).toThrow(
      /does not match/i
    );
  });

  it('has nothing to process for an image with no segment mask', () => {
    addSegment('img-1', 'Unbound');

    expect(store().imageVoxels('img-1').exists()).toBe(false);
  });
});
