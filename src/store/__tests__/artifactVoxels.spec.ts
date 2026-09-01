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
// The artifact-scoped half of the voxel accessor seam. The renderer, the paint
// widget, the probe, the save dialog, job staging and all-segments processes
// hold an artifact and no segment, so they cannot route through
// segmentVoxels(). Unlike the segment accessor, this one is constructible for
// an artifact that is gone: two of its consumers are Vue computeds keyed on an
// id that can vanish a tick before the component does.
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

/** An artifact this test owns a reference to, carrying two segments. */
function seatArtifact(imageId: string, values = new Uint8Array(VOXEL_COUNT)) {
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

const scalarsOf = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData();

describe('artifact voxel accessor', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('resolution', () => {
    it('is constructible for an artifact that does not exist', () => {
      expect(() => store().artifactVoxels('nope')).not.toThrow();
      expect(store().artifactVoxels('nope').exists()).toBe(false);
    });

    it('refuses voxel access for an artifact that does not exist', () => {
      const voxels = store().artifactVoxels('nope');

      expect(() => voxels.image()).toThrow();
      expect(() => voxels.scalars()).toThrow();
      expect(() => voxels.snapshot()).toThrow();
      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT))).toThrow();
      expect(() => voxels.ensureContains(FULL_EXTENT)).toThrow();
    });

    it('re-resolves the artifact on every call rather than capturing it', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);
      expect(voxels.exists()).toBe(true);

      store().removeArtifact(seat.artifactId);

      expect(voxels.exists()).toBe(false);
      expect(() => voxels.image()).toThrow();
    });
  });

  describe('image()', () => {
    it('hands back the live labelmap registered for the artifact', () => {
      const seat = seatArtifact('img-1');

      expect(store().artifactVoxels(seat.artifactId).image()).toBe(
        seat.labelmap
      );
    });

    it('is the same storage the segment accessor resolves', () => {
      const seat = seatArtifact('img-1');

      expect(store().artifactVoxels(seat.artifactId).image()).toBe(
        store()
          .segmentVoxels(seat.first.segmentationId, seat.first.segmentId)
          .image()
      );
    });
  });

  describe('scalars()', () => {
    it('aliases the live buffer rather than copying it', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);

      expect(voxels.scalars()).toBe(scalarsOf(seat.labelmap));

      voxels.scalars()[5] = 1;
      expect(scalarsOf(seat.labelmap)[5]).toBe(1);
    });
  });

  describe('snapshot()', () => {
    it('copies the voxels instead of aliasing them', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifact('img-1', values);
      const voxels = store().artifactVoxels(seat.artifactId);

      const copy = voxels.snapshot();
      expect(copy).not.toBe(scalarsOf(seat.labelmap));
      expect(Array.from(copy)).toEqual(Array.from(scalarsOf(seat.labelmap)));

      copy[0] = 9;
      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });

    it('covers every segment of the artifact, not one label value', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      values[1] = 2;
      const seat = seatArtifact('img-1', values);

      const copy = store().artifactVoxels(seat.artifactId).snapshot();
      expect(copy).toHaveLength(VOXEL_COUNT);
      expect(Array.from(copy).slice(0, 2)).toEqual([1, 2]);
    });
  });

  describe('apply()', () => {
    it('writes through the live buffer instead of swapping it out', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);
      const buffer = scalarsOf(seat.labelmap);
      const before = seat.labelmap.getMTime();

      const next = new Uint8Array(VOXEL_COUNT);
      next[3] = 1;
      next[4] = 2;
      voxels.apply(next);

      // Mappers and the paint engine hold the buffer, not just the image.
      expect(scalarsOf(seat.labelmap)).toBe(buffer);
      expect(voxels.image()).toBe(seat.labelmap);
      expect(Array.from(buffer).slice(3, 5)).toEqual([1, 2]);
      expect(seat.labelmap.getMTime()).toBeGreaterThan(before);
    });

    it('copies the given scalars instead of adopting them', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);

      const next = new Uint8Array(VOXEL_COUNT);
      next[0] = 1;
      voxels.apply(next);
      next[0] = 7;

      expect(scalarsOf(seat.labelmap)[0]).toBe(1);
    });

    it('rejects a wrong-length array and leaves the voxels alone', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const seat = seatArtifact('img-1', values);
      const voxels = store().artifactVoxels(seat.artifactId);

      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT - 1))).toThrow();
      expect(Array.from(scalarsOf(seat.labelmap))).toEqual(Array.from(values));
    });
  });

  describe('ensureContains()', () => {
    it('reports no invalidation for an extent the storage already covers', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);
      const buffer = scalarsOf(seat.labelmap);
      const before = seat.labelmap.getMTime();

      expect(voxels.ensureContains([1, 2, 1, 2, 0, 1])).toBe(false);
      expect(voxels.ensureContains(FULL_EXTENT)).toBe(false);

      expect(scalarsOf(seat.labelmap)).toBe(buffer);
      expect(seat.labelmap.getDimensions()).toEqual([...DIMENSIONS]);
      expect(seat.labelmap.getMTime()).toBe(before);
    });

    it('treats an empty extent as already covered', () => {
      const seat = seatArtifact('img-1');

      expect(
        store()
          .artifactVoxels(seat.artifactId)
          .ensureContains([0, -1, 0, -1, 0, -1])
      ).toBe(false);
    });

    it('rejects an extent a full-extent mask cannot cover', () => {
      const seat = seatArtifact('img-1');
      const voxels = store().artifactVoxels(seat.artifactId);

      expect(() => voxels.ensureContains([0, 4, 0, 3, 0, 1])).toThrow();
      expect(() => voxels.ensureContains([-1, 3, 0, 3, 0, 1])).toThrow();
      expect(seat.labelmap.getDimensions()).toEqual([...DIMENSIONS]);
    });
  });

  describe('shared storage', () => {
    it('shows a segment accessor write through the artifact accessor', () => {
      const seat = seatArtifact('img-1');
      const segment = store().segmentVoxels(
        seat.first.segmentationId,
        seat.first.segmentId
      );

      const next = new Uint8Array(VOXEL_COUNT);
      next[2] = 1;
      segment.apply(next);

      expect(
        Array.from(store().artifactVoxels(seat.artifactId).snapshot())[2]
      ).toBe(1);
    });

    it('shows an artifact accessor write through the segment accessor', () => {
      const seat = seatArtifact('img-1');

      store().artifactVoxels(seat.artifactId).scalars()[6] = 2;

      expect(
        Array.from(
          store()
            .segmentVoxels(seat.second.segmentationId, seat.second.segmentId)
            .snapshot()
        )[6]
      ).toBe(2);
    });
  });
});
