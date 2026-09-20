import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  expectCoveredExtentIsNoop,
  expectExtentPastParentThrows,
  SPEC_FULL_EXTENT as FULL_EXTENT,
  SPEC_VOXEL_COUNT as VOXEL_COUNT,
  addMask,
  deleteSegmentOf,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { isEmptyExtent } from '@/src/segmentation/geometry';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// The segment voxel accessor: the one contract every labelmap consumer that
// holds a segment routes through. Growth itself is pinned in
// boundedSegmentMasks.spec.ts; what is here is the accessor's own contract
// against a mask grown to the whole parent image, which the tolerant accessor
// shares once storage exists.
// ---------------------------------------------------------------------------

/**
 * Two segments of one image, each with its own mask grown to the whole parent
 * image, so identity assertions have a labelmap reference to compare against.
 */
function seatArtifactSegment(imageId: string, values: Uint8Array) {
  const first = addMask(imageId, 'Tumor');
  const second = addMask(imageId, 'Node');

  const grow = (maskId: string) => {
    const voxels = store().maskVoxels(maskId);
    voxels.materialize();
    voxels.ensureContains(FULL_EXTENT);
  };
  grow(first);
  grow(second);
  store().maskVoxels(first).apply(values);

  return {
    labelmap: store().maskVoxels(first).binding()!.image,
    first,
    second,
  };
}

const scalarsOf = (labelmap: vtkLabelMap) =>
  labelmap.getPointData().getScalars().getData();

beforeEach(async () => {
  setActivePinia(createPinia());
  await seatImage('img-1');
});

describe('segment voxel accessor', () => {
  describe('resolution', () => {
    it('throws for a mask that does not exist', () => {
      store().ensureSegmentationForImage('img-1');
      expect(() => store().maskVoxels('nope')).toThrow(/No such mask/);
    });

    it('resolves the segment on every call rather than capturing it', () => {
      const target = addMask('img-1');
      const voxels = store().maskVoxels(target);
      expect(voxels.binding()).toBeUndefined();

      // Materializing through a second accessor is visible through the first.
      store().maskVoxels(target).materialize();
      expect(voxels.binding()?.image).toBeDefined();

      deleteSegmentOf(target);
      expect(() => voxels.binding()).toThrow();
    });
  });

  describe('before materialize', () => {
    it('reports no storage and allocates none', () => {
      const target = addMask('img-1');

      expect(store().maskVoxels(target).binding()).toBeUndefined();
      expect(store().boundMaskIds('img-1')).toHaveLength(0);
    });

    it('refuses voxel access instead of allocating on read', () => {
      const target = addMask('img-1');
      const voxels = store().maskVoxels(target);

      expect(() => voxels.image()).toThrow();
      expect(() => voxels.snapshot()).toThrow();
      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT))).toThrow();
      expect(() => voxels.ensureContains(FULL_EXTENT)).toThrow();
      expect(store().boundMaskIds('img-1')).toHaveLength(0);
    });
  });

  describe('materialize', () => {
    it('allocates a mask that covers nothing and binds the segment to it', () => {
      const target = addMask('img-1');
      const binding = store().maskVoxels(target).materialize();

      expect(store().boundMaskIds('img-1')).toHaveLength(1);
      expect(store().boundMaskIds('img-1')[0]).toBe(target);
      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect(store().maskVoxels(target).image().getDimensions()).toEqual([
        0, 0, 0,
      ]);
      expect(scalarsOf(store().maskVoxels(target).image())).toHaveLength(0);
    });

    it('is idempotent', () => {
      const target = addMask('img-1');
      const first = store().maskVoxels(target).materialize();
      const image = store().maskVoxels(target).image();
      const second = store().maskVoxels(target).materialize();

      expect(second).toBe(first);
      expect(store().boundMaskIds('img-1')).toHaveLength(1);
      expect(store().maskVoxels(target).image()).toBe(image);
    });

    it('gives each segment of an image its own mask', () => {
      const first = addMask('img-1', 'Tumor');
      const second = addMask('img-1', 'Node');

      const a = store().maskVoxels(first).materialize();
      const b = store().maskVoxels(second).materialize();

      expect(store().boundMaskIds('img-1')).toHaveLength(2);
      expect(b.image).not.toBe(a.image);
      expect(store().maskVoxels(second).image()).not.toBe(
        store().maskVoxels(first).image()
      );
    });
  });

  describe('scalars()', () => {
    it('refuses before materialize', () => {
      const target = addMask('img-1');

      expect(() => store().maskVoxels(target).scalars()).toThrow(/No storage/);
      expect(store().boundMaskIds('img-1')).toHaveLength(0);
    });
  });
});

describe.each([
  ['strict', (maskId: string) => store().maskVoxels(maskId)],
  ['tolerant', (maskId: string) => store().findMaskVoxels(maskId)],
])('the %s accessor on a grown mask', (_name, accessorOf) => {
  const seatVoxels = (values = new Uint8Array(VOXEL_COUNT)) => {
    const seat = seatArtifactSegment('img-1', values);
    return { ...seat, voxels: accessorOf(seat.first) };
  };

  describe('image()', () => {
    it('hands back the live labelmap the binding holds', () => {
      const { voxels, labelmap } = seatVoxels();

      expect(voxels.image()).toBe(labelmap);
    });

    it('sees writes made through it', () => {
      const { voxels, labelmap } = seatVoxels();

      scalarsOf(voxels.image())[5] = 1;

      expect(Array.from(voxels.snapshot())[5]).toBe(1);
      expect(Array.from(scalarsOf(labelmap))[5]).toBe(1);
    });
  });

  describe('scalars()', () => {
    it('aliases the live buffer rather than copying it', () => {
      const { voxels, labelmap } = seatVoxels();

      // The paint stroke reads this per candidate voxel while the brush writes
      // the same buffer, so a copy would be both stale and a per-stroke
      // allocation the size of the volume.
      expect(voxels.scalars()).toBe(scalarsOf(labelmap));

      voxels.scalars()[5] = 1;
      expect(scalarsOf(labelmap)[5]).toBe(1);
    });
  });

  describe('snapshot()', () => {
    it('copies the voxels instead of aliasing them', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const { voxels, labelmap } = seatVoxels(values);

      const copy = voxels.snapshot();
      expect(Array.from(copy)).toEqual(Array.from(scalarsOf(labelmap)));

      copy[0] = 0;
      expect(scalarsOf(labelmap)[0]).toBe(1);

      scalarsOf(labelmap)[1] = 1;
      expect(copy[1]).toBe(0);
    });

    it('covers the whole mask the segment writes through', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      values[2] = 1;
      const { voxels, second } = seatVoxels(values);

      expect(Array.from(voxels.snapshot()).slice(0, 3)).toEqual([1, 0, 1]);
      expect(accessorOf(second).snapshot()).toHaveLength(VOXEL_COUNT);
    });
  });

  describe('apply()', () => {
    it('writes through the live buffer and marks the image modified', () => {
      const { voxels, labelmap } = seatVoxels();
      const buffer = scalarsOf(labelmap);
      const before = labelmap.getMTime();

      const next = new Uint8Array(VOXEL_COUNT);
      next[3] = 1;
      next[5] = 1;
      voxels.apply(next);

      // Mappers and the paint engine hold the buffer, and actors the image.
      expect(scalarsOf(labelmap)).toBe(buffer);
      expect(voxels.image()).toBe(labelmap);
      expect(Array.from(buffer).slice(3, 6)).toEqual([1, 0, 1]);
      expect(labelmap.getMTime()).toBeGreaterThan(before);
    });

    it('copies the given scalars instead of adopting them', () => {
      const { voxels, labelmap } = seatVoxels();

      const next = new Uint8Array(VOXEL_COUNT);
      next[0] = 1;
      voxels.apply(next);
      next[0] = 0;

      expect(scalarsOf(labelmap)[0]).toBe(1);
    });

    it('rejects a wrong-length array and leaves the voxels alone', () => {
      const values = new Uint8Array(VOXEL_COUNT);
      values[0] = 1;
      const { voxels, labelmap } = seatVoxels(values);

      expect(() => voxels.apply(new Uint8Array(VOXEL_COUNT - 1))).toThrow();
      expect(Array.from(scalarsOf(labelmap))).toEqual(Array.from(values));
    });
  });

  describe('ensureContains()', () => {
    it('reports no invalidation for an extent the storage already covers', () => {
      const { voxels, labelmap } = seatVoxels();

      expectCoveredExtentIsNoop(voxels, labelmap);
    });

    it('treats an empty extent as already covered', () => {
      const { voxels } = seatVoxels();

      expect(voxels.ensureContains([0, -1, 0, -1, 0, -1])).toBe(false);
    });

    it('rejects an extent that leaves the parent image', () => {
      const { voxels, labelmap } = seatVoxels();

      expectExtentPastParentThrows(voxels, labelmap);
    });
  });
});
