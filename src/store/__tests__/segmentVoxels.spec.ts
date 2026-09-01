import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import type { Extent3D } from '@/src/types/segmentation';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// The segment voxel accessor: the one contract every labelmap consumer that
// holds a segment routes through. Storage is one full-extent mask per
// artifact, so `ensureContains` can only assert, never grow.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];
const FULL_EXTENT: Extent3D = [0, 3, 0, 3, 0, 1];

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

/** A segment with no storage: "add segment" never allocates voxels. */
function addSegment(imageId: string, name?: string) {
  const segmentation = store().ensureSegmentationForImage(imageId);
  const segment = store().createSegment(
    segmentation.id,
    name ? { name } : undefined
  );
  return { segmentationId: segmentation.id, segmentId: segment.id };
}

/**
 * A segment backed by a labelmap this test owns a reference to, so identity
 * assertions do not have to go through the store's internal index.
 */
function seatArtifactSegment(imageId: string, values: Uint8Array) {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  labelmap
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  labelmap.computeTransforms();

  const artifactId = store().registerArtifact(labelmap, {
    parentImage: imageId,
    name: 'Group 1',
  });
  const [first, second] = store().setArtifactSegments(artifactId, [
    { value: 1, name: 'Tumor', color: [255, 0, 0, 255], visible: true },
    { value: 2, name: 'Node', color: [0, 255, 0, 255], visible: true },
  ]);
  const segmentationId = store().getSegmentationForArtifact(artifactId)!.id;
  return {
    labelmap,
    artifactId,
    segmentationId,
    first: { segmentationId, segmentId: first.id },
    second: { segmentationId, segmentId: second.id },
  };
}

const voxelsOf = (target: { segmentationId: string; segmentId: string }) =>
  store().segmentVoxels(target.segmentationId, target.segmentId);

const scalarsOf = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData();

describe('segment voxel accessor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('resolution', () => {
    it('throws for a segment that does not exist', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      expect(() => store().segmentVoxels(segmentation.id, 'nope')).toThrow(
        /No such segment/
      );
    });

    it('resolves the segment on every call rather than capturing it', () => {
      const target = addSegment('img-1');
      const voxels = voxelsOf(target);
      expect(voxels.binding()).toBeUndefined();

      // Materializing through a second accessor is visible through the first.
      voxelsOf(target).materialize();
      expect(voxels.binding()?.labelValue).toBeGreaterThan(0);

      store().deleteSegment(target.segmentationId, target.segmentId);
      expect(() => voxels.binding()).toThrow();
    });
  });

  describe('before materialize', () => {
    it('reports no storage and allocates none', () => {
      const target = addSegment('img-1');

      expect(voxelsOf(target).binding()).toBeUndefined();
      expect(store().artifactsForImage('img-1')).toHaveLength(0);
    });

    it('refuses voxel access instead of allocating on read', () => {
      const target = addSegment('img-1');
      const voxels = voxelsOf(target);

      expect(() => voxels.image()).toThrow();
      expect(() => voxels.snapshot()).toThrow();
      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT))).toThrow();
      expect(() => voxels.ensureContains(FULL_EXTENT)).toThrow();
      expect(store().artifactsForImage('img-1')).toHaveLength(0);
    });
  });

  describe('materialize', () => {
    it('allocates one parent-shaped mask and binds the segment to it', () => {
      const target = addSegment('img-1');
      const binding = voxelsOf(target).materialize();

      expect(store().artifactsForImage('img-1')).toHaveLength(1);
      expect(binding.artifactId).toBe(store().artifactsForImage('img-1')[0]);
      expect(binding.labelValue).toBeGreaterThan(0);
      expect(binding.extent).toEqual(FULL_EXTENT);
      expect(voxelsOf(target).image().getDimensions()).toEqual([...DIMENSIONS]);
      expect(scalarsOf(voxelsOf(target).image())).toHaveLength(VOXEL_COUNT);
    });

    it('is idempotent', () => {
      const target = addSegment('img-1');
      const first = voxelsOf(target).materialize();
      const image = voxelsOf(target).image();
      const second = voxelsOf(target).materialize();

      expect(second).toEqual(first);
      expect(store().artifactsForImage('img-1')).toHaveLength(1);
      expect(voxelsOf(target).image()).toBe(image);
    });

    it('shares one artifact between segments of the same image, with distinct label values', () => {
      const first = addSegment('img-1', 'Tumor');
      const second = addSegment('img-1', 'Node');

      const a = voxelsOf(first).materialize();
      const b = voxelsOf(second).materialize();

      expect(store().artifactsForImage('img-1')).toHaveLength(1);
      expect(b.artifactId).toBe(a.artifactId);
      expect(b.labelValue).not.toBe(a.labelValue);
      expect(voxelsOf(second).image()).toBe(voxelsOf(first).image());
    });
  });

  describe('image()', () => {
    it('hands back the live labelmap registered for the artifact', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      expect(voxels.image()).toBe(seat.labelmap);
      expect(voxels.binding()?.artifactId).toBe(seat.artifactId);
    });

    it('sees writes made through it', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      scalarsOf(voxels.image())[5] = 1;

      expect(Array.from(voxels.snapshot())[5]).toBe(1);
      expect(Array.from(scalarsOf(seat.labelmap))[5]).toBe(1);
    });
  });

  describe('scalars()', () => {
    it('aliases the live buffer rather than copying it', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      // The paint stroke reads this per candidate voxel while the brush writes
      // the same buffer, so a copy would be both stale and a per-stroke
      // allocation the size of the volume.
      expect(voxels.scalars()).toBe(scalarsOf(seat.labelmap));

      voxels.scalars()[5] = 1;
      expect(scalarsOf(seat.labelmap)[5]).toBe(1);
    });

    it('refuses before materialize', () => {
      const target = addSegment('img-1');

      expect(() => voxelsOf(target).scalars()).toThrow(/No storage/);
      expect(store().artifactsForImage('img-1')).toHaveLength(0);
    });
  });

  describe('snapshot()', () => {
    it('copies the voxels instead of aliasing them', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifactSegment('img-1', values);
      const voxels = voxelsOf(seat.first);

      const copy = voxels.snapshot();
      expect(Array.from(copy)).toEqual(Array.from(scalarsOf(seat.labelmap)));

      copy[0] = 9;
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);

      scalarsOf(seat.labelmap)[1] = 7;
      expect(copy[1]).toBe(0);
    });

    it('covers the whole storage the segment writes through, other label values included', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      values[1] = 2;
      const seat = seatArtifactSegment('img-1', values);

      expect(Array.from(voxelsOf(seat.first).snapshot()).slice(0, 2)).toEqual([
        1, 2,
      ]);
      expect(voxelsOf(seat.second).snapshot()).toHaveLength(VOXEL_COUNT);
    });
  });

  describe('apply()', () => {
    it('replaces the voxels and marks the image modified', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);
      const before = seat.labelmap.getMTime();

      const next = new Uint8Array(VOXEL_COUNT);
      next[3] = 1;
      next[4] = 2;
      voxels.apply(next);

      expect(Array.from(voxels.snapshot()).slice(3, 5)).toEqual([1, 2]);
      // Actors bind to the image, so bulk replace must not swap it out.
      expect(voxels.image()).toBe(seat.labelmap);
      expect(seat.labelmap.getMTime()).toBeGreaterThan(before);
    });

    it('rejects a wrong-length array and leaves the voxels alone', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifactSegment('img-1', values);
      const voxels = voxelsOf(seat.first);

      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT - 1))).toThrow();
      expect(Array.from(voxels.snapshot())).toEqual(
        Array.from(scalarsOf(seat.labelmap))
      );
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });
  });

  describe('ensureContains()', () => {
    it('reports no invalidation for an extent the storage already covers', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);
      const scalars = scalarsOf(seat.labelmap);
      const before = seat.labelmap.getMTime();

      expect(voxels.ensureContains([1, 2, 1, 2, 0, 1])).toBe(false);
      expect(voxels.ensureContains(FULL_EXTENT)).toBe(false);

      expect(scalarsOf(seat.labelmap)).toBe(scalars);
      expect(seat.labelmap.getDimensions()).toEqual([...DIMENSIONS]);
      expect(seat.labelmap.getMTime()).toBe(before);
    });

    it('treats an empty extent as already covered', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));

      expect(voxelsOf(seat.first).ensureContains([0, -1, 0, -1, 0, -1])).toBe(
        false
      );
    });

    it('rejects an extent a full-extent mask cannot cover', () => {
      const seat = seatArtifactSegment('img-1', new Uint8Array(VOXEL_COUNT));
      const voxels = voxelsOf(seat.first);

      expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 1])).toThrow();
      expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 1])).toThrow();
      expect(seat.labelmap.getDimensions()).toEqual([...DIMENSIONS]);
    });
  });
});
