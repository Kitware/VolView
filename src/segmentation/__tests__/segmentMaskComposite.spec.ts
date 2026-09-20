import {
  compositeLabelmap,
  layeredSegments,
} from '@/src/segmentation/io/composition';
import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentStore } from '@/src/segmentation/segments';
import { segmentRenderMask } from '@/src/segmentation/rendering/renderMask';
import { buildSegNrrdMetadata } from '@/src/io/segNrrdMetadata';
import {
  listMasks,
  maskScalars,
  type SegmentMask,
} from '@/src/segmentation/model';
import {
  addMask,
  extentOf,
  flatIndex,
  labelValueOf,
  maskValueAt,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  voxelCount,
  type Index3,
  segmentOfMask,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import {
  LABELMAP_MAX_VALUE,
  SEGMENT_VALUE,
} from '@/src/segmentation/masks/labelValue';

const appearanceOf = (segment: { segmentId: string }) =>
  useSegmentStore().segments.appearanceOf(segment.segmentId);

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

const parentOffset = flatIndex(DIMENSIONS);

const compositeScalars = (imageId: string, members?: SegmentMask[]) =>
  maskScalars(compositeLabelmap(imageId, members).labelmap);

const segmentIdsOf = (imageId: string) =>
  listMasks(store().getSegmentationForImage(imageId)!).map(
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
    const tumor = addMask('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const { labelmap } = compositeLabelmap('img-1');

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

  // The masks all hold SEGMENT_VALUE; the values that tell segments apart in
  // one file are assigned here, and the descriptors are what name them.
  it('writes every segment at its own label value, at its own parent voxels', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);

    const { labelmap, segments } = compositeLabelmap('img-1');
    const scalars = maskScalars(labelmap);

    expect(new Set(segments.map((segment) => segment.value)).size).toBe(2);
    expect(scalars[parentOffset(1, 1, 1)]).toBe(segments[0].value);
    expect(scalars[parentOffset(3, 3, 3)]).toBe(segments[1].value);
  });

  it('leaves everything no segment covers at the background value', () => {
    const tumor = addMask('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const scalars = compositeScalars('img-1');

    expect(scalars).toHaveLength(voxelCount(DIMENSIONS));
    expect(Array.from(scalars).filter((value) => value !== 0)).toHaveLength(1);
  });

  it('gives the earlier segment the voxel where two overlap', () => {
    const under = addMask('img-1', 'Under');
    const over = addMask('img-1', 'Over');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);

    const { labelmap, segments } = compositeLabelmap('img-1');
    expect(maskScalars(labelmap)[parentOffset(1, 1, 1)]).toBe(
      segments[0].value
    );
  });

  it('describes segments with no voxels without allocating storage', () => {
    const unbound = addMask('img-1', 'Unbound');
    const empty = addMask('img-1', 'Empty');
    store().maskVoxels(empty).materialize();
    const tumor = addMask('img-1', 'Tumor');
    seedVoxel(tumor, [1, 1, 1]);

    const { labelmap, segments } = compositeLabelmap('img-1');
    const scalars = maskScalars(labelmap);

    // These are labelmap descriptors, which carry the resolved name already.
    expect(segments.map((segment) => segment.name)).toEqual([
      'Unbound',
      'Empty',
      'Tumor',
    ]);
    expect(new Set(segments.map((segment) => segment.value)).size).toBe(3);
    expect(store().findMaskBinding(unbound)).toBeUndefined();
    expect(scalars[parentOffset(1, 1, 1)]).toBe(segments[2].value);
    expect(Array.from(scalars).filter((value) => value !== 0)).toHaveLength(1);
  });

  it('refuses more segment descriptors than a byte labelmap can encode', () => {
    Array.from({ length: 256 }, (_, index) =>
      addMask('img-1', `Segment ${index + 1}`)
    );

    expect(() => compositeLabelmap('img-1')).toThrow(/at most 255 segments/);
  });

  // The store holds as many segments as an image needs; the one-byte cap is
  // the export file's, so layeredSegments hands back groups that fit even
  // when none of them overlap and one group would do.
  it('splits a group past the byte cap into files that fit', async () => {
    const wide: Index3 = [300, 1, 1];
    await seatImage('img-wide', { ...GRID, dimensions: wide });
    const masks = Array.from({ length: 300 }, (_, index) =>
      addMask('img-wide', `Segment ${index + 1}`)
    );
    // One voxel each, none shared, so overlap alone would leave one group.
    masks.forEach((maskId, index) => seedVoxel(maskId, [index, 0, 0]));

    const groups = layeredSegments('img-wide');

    expect(groups.flat()).toHaveLength(300);
    expect(groups.every((group) => group.length <= LABELMAP_MAX_VALUE)).toBe(
      true
    );
    groups.forEach((group) =>
      expect(() => compositeLabelmap('img-wide', group)).not.toThrow()
    );
  });

  it('describes the image’s segments in order, keyed by label value', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);
    useSegmentStore().segments.updateSegment(segmentOfMask(node), {
      visible: false,
    });

    const { segments } = compositeLabelmap('img-1');

    expect(segments.map((segment) => segment.name)).toEqual(['Tumor', 'Node']);
    expect(segments.map((segment) => segment.value)).toEqual([1, 2]);
    expect(segments[0]).toMatchObject({ visible: true });
    expect(segments[1]).toMatchObject({ visible: false });
  });

  it('composes an image with no segments to an empty labelmap', () => {
    const { labelmap, segments } = compositeLabelmap('img-1');

    expect(segments).toEqual([]);
    expect(labelmap.getDimensions()).toEqual(
      parentImage('img-1').getDimensions()
    );
    expect(maskScalars(labelmap).every((value) => value === 0)).toBe(true);
  });

  it('copies the voxels out rather than aliasing the masks', () => {
    const tumor = addMask('img-1', 'Tumor');
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

  const layerEntries = () =>
    layeredSegments('img-1').map((group) =>
      buildSegNrrdMetadata(
        compositeLabelmap('img-1', group).segments,
        DIMENSIONS
      )
    );

  it('leaves segments that do not overlap composed as one', () => {
    const tumor = addMask('img-1', 'Tumor');
    const node = addMask('img-1', 'Node');
    seedVoxel(tumor, [1, 1, 1]);
    seedVoxel(node, [3, 3, 3]);

    const groups = layeredSegments('img-1');

    expect(groups).toHaveLength(1);
    expect(compositeScalars('img-1', groups[0])).toEqual(
      compositeScalars('img-1')
    );
    expect(compositeLabelmap('img-1', groups[0]).segments).toEqual(
      compositeLabelmap('img-1').segments
    );
  });

  it('composes an overlapping segment into one of its own', () => {
    const under = addMask('img-1', 'Under');
    const over = addMask('img-1', 'Over');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);
    seedVoxel(over, [2, 2, 2]);

    const groups = layeredSegments('img-1');

    expect(
      groups.map((group) => group.map((segment) => appearanceOf(segment).name))
    ).toEqual([['Under'], ['Over']]);
    expect(compositeScalars('img-1', groups[0])[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(under)
    );
    expect(compositeScalars('img-1', groups[1])[parentOffset(1, 1, 1)]).toBe(
      labelValueOf(over)
    );
    expect(compositeScalars('img-1', groups[0])[parentOffset(2, 2, 2)]).toBe(0);
  });

  it('keeps a third segment with the first one it does not overlap', () => {
    const under = addMask('img-1', 'Under');
    const over = addMask('img-1', 'Over');
    const apart = addMask('img-1', 'Apart');
    seedVoxel(under, [1, 1, 1]);
    seedVoxel(over, [1, 1, 1]);
    seedVoxel(apart, [3, 3, 3]);

    expect(
      layeredSegments('img-1').map((group) =>
        group.map((segment) => appearanceOf(segment).name)
      )
    ).toEqual([['Under', 'Apart'], ['Over']]);
  });

  it('describes each of them as a self-contained layer', () => {
    const under = addMask('img-1', 'Under');
    const over = addMask('img-1', 'Over');
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
    expect(layeredSegments('img-1')).toEqual([[]]);
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
    // The source values named which voxels went where; the masks themselves
    // hold SEGMENT_VALUE, because each holds one segment.
    expect(maskValueAt(first, [1, 1, 1])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(second, [3, 3, 3])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(first, [3, 3, 3])).toBeUndefined();
  });

  it('bounds a segment to the box its voxels span', async () => {
    await importLabelmap([
      { value: 1, at: [1, 0, 2] },
      { value: 1, at: [2, 3, 2] },
    ]);

    const [only] = segmentIdsOf('parent-img');
    expect(extentOf(only)).toEqual([1, 2, 0, 3, 2, 2]);
    expect(maskValueAt(only, [1, 0, 2])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(only, [2, 3, 2])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(only, [1, 3, 2])).toBe(0);
  });

  // The source value survives in the decoded name, not in the storage: a
  // segment is told from its neighbours by identity, not by a byte.
  it('keeps each source label value in its decoded name', async () => {
    await importLabelmap([
      { value: 1, at: [1, 1, 1] },
      { value: 3, at: [3, 3, 3] },
    ]);

    const segmentation = store().getSegmentationForImage('parent-img')!;
    expect(
      listMasks(segmentation).map((segment) => appearanceOf(segment).name)
    ).toEqual(['Tumor 1', 'Tumor 3']);
    expect(segmentIdsOf('parent-img').map(labelValueOf)).toEqual([
      SEGMENT_VALUE,
      SEGMENT_VALUE,
    ]);
  });

  it('lines the split masks up with the parent grid', async () => {
    await importLabelmap([{ value: 1, at: [1, 2, 3] }]);

    const [only] = segmentIdsOf('parent-img');
    const mask = store().maskVoxels(only).image();
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

  // Export assigns its own values, so a round trip keeps the segmentation and
  // renumbers it: the same voxels are claimed, by the same segments, under
  // values the descriptors name.
  it('composes the same export voxels and geometry after rendering padded masks', async () => {
    const marks = [
      { value: 1, at: [1, 1, 1] as Index3 },
      { value: 1, at: [2, 1, 1] as Index3 },
      { value: 4, at: [3, 3, 3] as Index3 },
    ];
    await importLabelmap(marks);

    const before = compositeLabelmap('parent-img').labelmap;
    const beforeValues = Array.from(maskScalars(before));
    for (const id of segmentIdsOf('parent-img')) {
      const binding = store().maskVoxels(id).binding()!;
      const rendered = segmentRenderMask(
        binding.image,
        parentImage('parent-img'),
        binding.extent,
        { axis: 2, index: binding.extent[4] }
      )!;
      // A render-buffer write must never reach a saved segmentation.
      maskScalars(rendered).fill(9);
    }
    const { labelmap, segments } = compositeLabelmap('parent-img');
    expect(labelmap.getDimensions()).toEqual(before.getDimensions());
    expect(labelmap.getOrigin()).toEqual(before.getOrigin());
    expect(labelmap.getSpacing()).toEqual(before.getSpacing());
    expect(labelmap.getDirection()).toEqual(before.getDirection());
    expect(Array.from(maskScalars(labelmap))).toEqual(beforeValues);
    const composed = Array.from(maskScalars(labelmap));
    const source = Array.from(
      makeLabelmapImage(marks).getPointData().getScalars().getData()
    );

    expect(segments.map((segment) => segment.name)).toEqual([
      'Tumor 1',
      'Tumor 4',
    ]);
    // Source value 1 became export value 1, source value 4 became 2.
    const renumbered = new Map([
      [0, 0],
      [1, segments[0].value],
      [4, segments[1].value],
    ]);
    expect(composed).toEqual(source.map((value) => renumbered.get(value)));
  });
});
