import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { TypedArray } from '@kitware/vtk.js/types';

import { useImageCacheStore } from '@/src/store/image-cache';
import { buildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import { listSegments, type Segment } from '@/src/types/segmentation';
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
// GROUP is what a save composes first: one labelmap carries one label per
// voxel, so segments that overlap are composed into separate ones and saved as
// separate files.
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

describe('grouping the segments that cannot share one labelmap', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', GRID);
  });

  const groupScalars = (group: Segment[]) =>
    Array.from(
      store()
        .compositeLabelmap('img-1', group)
        .labelmap.getPointData()
        .getScalars()
        .getData() as TypedArray
    );

  const layerEntries = () =>
    store()
      .layeredSegments('img-1')
      .map((group) =>
        buildSegNrrdMetadata(
          store().compositeLabelmap('img-1', group).segments,
          DIMENSIONS
        )
      );

  it('leaves segments that do not overlap composed as one', () => {
    const tumor = addSegment('img-1', 'Tumor');
    const node = addSegment('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);

    const groups = store().layeredSegments('img-1');

    expect(groups).toHaveLength(1);
    expect(groupScalars(groups[0])).toEqual(
      Array.from(compositeScalars('img-1'))
    );
    expect(store().compositeLabelmap('img-1', groups[0]).segments).toEqual(
      store().compositeLabelmap('img-1').segments
    );
  });

  it('composes an overlapping segment into one of its own', () => {
    const under = addSegment('img-1', 'Under');
    const over = addSegment('img-1', 'Over');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);
    seedVoxel(over, [2, 2, 2]);

    const groups = store().layeredSegments('img-1');

    expect(groups.map((group) => group.map((segment) => segment.name))).toEqual(
      [['Under'], ['Over']]
    );
    expect(groupScalars(groups[0])[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(under)
    );
    expect(groupScalars(groups[1])[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(over)
    );
    expect(groupScalars(groups[0])[parentOffset(2, 2, 2)]).toBe(0);
  });

  it('keeps a third segment with the first one it does not overlap', () => {
    const under = addSegment('img-1', 'Under');
    const over = addSegment('img-1', 'Over');
    const apart = addSegment('img-1', 'Apart');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);
    seedVoxel(apart, [3, 3, 3]);

    expect(
      store()
        .layeredSegments('img-1')
        .map((group) => group.map((segment) => segment.name))
    ).toEqual([['Under', 'Apart'], ['Over']]);
  });

  it('describes each of them as a self-contained layer', () => {
    const under = addSegment('img-1', 'Under');
    const over = addSegment('img-1', 'Over');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);

    const entries = layerEntries();

    expect(entries).toHaveLength(2);
    expect(
      entries.flatMap((file) =>
        [...file].filter(([key]) => key.endsWith('_Layer'))
      )
    ).toEqual([
      ['Segment0_Layer', '0'],
      ['Segment0_Layer', '0'],
    ]);
    expect(entries.map((file) => file.get('Segment0_LabelValue'))).toEqual([
      String(labelValueOf(under)),
      String(labelValueOf(over)),
    ]);
  });

  it('composes one labelmap for an image with no segments', () => {
    expect(store().layeredSegments('img-1')).toEqual([[]]);
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
