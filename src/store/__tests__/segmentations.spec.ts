import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { CATEGORICAL_COLORS } from '@/src/config';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

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

const store = () => useSegmentationStore();

const artifactScalars = (artifactId: string) =>
  store().artifactIndex[artifactId].getPointData().getScalars().getData();

const bindingOf = (segmentationId: string, segmentId: string) =>
  store().getSegment(segmentationId, segmentId).representations.labelmap;

/** Creates a bound segment and hands back the ids and its binding. */
function makeBoundSegment(segmentationId: string, name?: string) {
  const segment = store().createSegment(
    segmentationId,
    name ? { name } : undefined
  );
  store().ensureLabelmapBinding(segmentationId, segment.id);
  const binding = bindingOf(segmentationId, segment.id)!;
  return { id: segment.id, binding };
}

describe('segmentation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('one segmentation per parent image', () => {
    it('reports no segmentation for an image until one is ensured', async () => {
      await seatImage('img-1');

      expect(store().getSegmentationForImage('img-1')).toBeFalsy();
    });

    it('ensures a segmentation bound to its parent image', async () => {
      await seatImage('img-1');

      const segmentation = store().ensureSegmentationForImage('img-1');

      expect(segmentation.parentImageId).toBe('img-1');
      expect(segmentation.segments).toEqual({});
      expect(segmentation.order).toEqual([]);
      expect(store().byParentImage['img-1']).toBe(segmentation.id);
      expect(store().segmentations[segmentation.id]).toBeTruthy();
    });

    it('returns the existing segmentation on a second ensure', async () => {
      await seatImage('img-1');

      const first = store().ensureSegmentationForImage('img-1');
      store().createSegment(first.id);
      const second = store().ensureSegmentationForImage('img-1');

      expect(second.id).toBe(first.id);
      expect(Object.keys(store().segmentations)).toHaveLength(1);
      expect(store().getSegmentationForImage('img-1')!.id).toBe(first.id);
    });

    it('keeps separate segmentations for separate images', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');

      const first = store().ensureSegmentationForImage('img-1');
      const second = store().ensureSegmentationForImage('img-2');

      expect(second.id).not.toBe(first.id);
      expect(store().byParentImage).toEqual({
        'img-1': first.id,
        'img-2': second.id,
      });
    });
  });

  describe('createSegment', () => {
    it('needs no storage choice: the binding is absent until it is ensured', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const segment = store().createSegment(segmentationId);

      expect(segment.representations.labelmap).toBeUndefined();
      expect(bindingOf(segmentationId, segment.id)).toBeUndefined();
      expect(
        store().resolveLabelmapBinding(segmentationId, segment.id)
      ).toBeFalsy();
      expect(Object.keys(store().artifactIndex)).toEqual([]);
      expect(Object.keys(store().artifactMeta)).toEqual([]);
    });

    it('appends the segment to the segmentation order', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = store().createSegment(segmentationId);
      const second = store().createSegment(segmentationId);

      expect(store().segmentations[segmentationId].order).toEqual([
        first.id,
        second.id,
      ]);
      expect(store().getSegment(segmentationId, second.id).id).toBe(second.id);
    });

    it('defaults to visible, unlocked segments', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const segment = store().createSegment(segmentationId);

      expect(segment.visible).toBe(true);
      expect(segment.locked).toBe(false);
    });

    it('cycles the categorical palette for default colors', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const colors = [
        store().createSegment(segmentationId).color,
        store().createSegment(segmentationId).color,
      ];

      colors.forEach((color) => {
        expect(CATEGORICAL_COLORS).toContainEqual([...color].slice(0, 3));
        expect(color[3]).toBe(255);
      });
      expect([...colors[0]]).not.toEqual([...colors[1]]);
    });

    it('picks a unique default name for each new segment', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const names = [
        store().createSegment(segmentationId).name,
        store().createSegment(segmentationId).name,
        store().createSegment(segmentationId).name,
      ];

      expect(new Set(names).size).toBe(3);
      names.forEach((name) => expect(name.length).toBeGreaterThan(0));
    });

    it('takes a name and color from the caller', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const segment = store().createSegment(segmentationId, {
        name: 'Tumor',
        color: [1, 2, 3, 255],
      });

      expect(segment.name).toBe('Tumor');
      expect([...segment.color]).toEqual([1, 2, 3, 255]);
      expect(store().getSegment(segmentationId, segment.id).name).toBe('Tumor');
    });

    it('keeps duplicate and blank names', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = store().createSegment(segmentationId, { name: 'Tumor' });
      const second = store().createSegment(segmentationId, { name: 'Tumor' });
      const blank = store().createSegment(segmentationId, { name: '' });
      store().updateSegment(segmentationId, first.id, { name: '' });

      expect(second.id).not.toBe(first.id);
      expect(store().getSegment(segmentationId, second.id).name).toBe('Tumor');
      expect(store().getSegment(segmentationId, blank.id).name).toBe('');
      expect(store().getSegment(segmentationId, first.id).name).toBe('');
      expect(store().segmentations[segmentationId].order).toEqual([
        first.id,
        second.id,
        blank.id,
      ]);
    });
  });

  describe('ensureLabelmapBinding', () => {
    it('allocates one artifact shaped like the parent image', async () => {
      await seatImage('img-1', 'Chest CT');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect(Object.keys(store().artifactIndex)).toEqual([binding.artifactId]);
      expect([
        ...store().artifactIndex[binding.artifactId].getDimensions(),
      ]).toEqual([...DIMENSIONS]);
      expect(artifactScalars(binding.artifactId)).toHaveLength(VOXEL_COUNT);
      expect(store().artifactMeta[binding.artifactId].parentImage).toBe(
        'img-1'
      );
      expect(
        store().artifactMeta[binding.artifactId].name.length
      ).toBeGreaterThan(0);
    });

    it('covers the full parent extent in this phase', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect([...binding.extent]).toEqual([
        0,
        DIMENSIONS[0] - 1,
        0,
        DIMENSIONS[1] - 1,
        0,
        DIMENSIONS[2] - 1,
      ]);
    });

    it('allocates a nonzero label value', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect(binding.labelValue).toBeGreaterThan(0);
    });

    it('returns the same binding on a second call and allocates nothing new', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentationId);

      const first = store().ensureLabelmapBinding(segmentationId, segment.id);
      const second = store().ensureLabelmapBinding(segmentationId, segment.id);

      expect(second.artifactId).toBe(first.artifactId);
      expect(second.labelValue).toBe(first.labelValue);
      expect(Object.keys(store().artifactIndex)).toHaveLength(1);
    });

    it('gives two segments of one segmentation distinct values in the shared artifact', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      expect(second.binding.artifactId).toBe(first.binding.artifactId);
      expect(second.binding.labelValue).not.toBe(first.binding.labelValue);
      expect(Object.keys(store().artifactIndex)).toHaveLength(1);
    });

    it('resolves a binding to the artifact labelmap and its label value', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const { id: segmentId, binding } = makeBoundSegment(segmentationId);

      const resolved = store().resolveLabelmapBinding(
        segmentationId,
        segmentId
      );

      expect(resolved!.labelValue).toBe(binding.labelValue);
      expect(resolved!.labelmap.getPointData().getScalars().getData()).toBe(
        artifactScalars(binding.artifactId)
      );
    });
  });

  describe('stable identity', () => {
    it('keeps segment ids and bindings across rename, recolor, and reorder', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      store().updateSegment(segmentationId, first.id, {
        name: 'Primary tumor',
        color: [7, 8, 9, 255],
        visible: false,
        locked: true,
      });
      store().reorderSegments(segmentationId, [second.id, first.id]);

      const renamed = store().getSegment(segmentationId, first.id);
      expect(renamed.id).toBe(first.id);
      expect(renamed.name).toBe('Primary tumor');
      expect([...renamed.color]).toEqual([7, 8, 9, 255]);
      expect(renamed.visible).toBe(false);
      expect(renamed.locked).toBe(true);
      expect(renamed.representations.labelmap).toEqual(first.binding);
      expect(store().getSegment(segmentationId, second.id).id).toBe(second.id);
      expect(store().segmentations[segmentationId].order).toEqual([
        second.id,
        first.id,
      ]);
    });

    it('leaves other segments untouched when one is updated', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = store().createSegment(segmentationId, { name: 'Tumor' });
      const second = store().createSegment(segmentationId, { name: 'Node' });

      store().updateSegment(segmentationId, first.id, { name: 'Renamed' });

      expect(store().getSegment(segmentationId, second.id).name).toBe('Node');
    });
  });

  describe('duplicate label values across artifacts', () => {
    it('resolve to different segments', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      const one = store().ensureSegmentationForImage('img-1').id;
      const two = store().ensureSegmentationForImage('img-2').id;

      const first = makeBoundSegment(one, 'Tumor');
      const second = makeBoundSegment(two, 'Tumor');

      expect(second.binding.labelValue).toBe(first.binding.labelValue);
      expect(second.binding.artifactId).not.toBe(first.binding.artifactId);
      expect(second.id).not.toBe(first.id);
      expect(store().getSegment(one, first.id).id).toBe(first.id);
      expect(store().getSegment(two, second.id).id).toBe(second.id);
      expect(store().resolveLabelmapBinding(one, first.id)!.labelmap).not.toBe(
        store().resolveLabelmapBinding(two, second.id)!.labelmap
      );
    });
  });

  describe('deleteSegment', () => {
    it('clears only the deleted segment voxels', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const doomed = makeBoundSegment(segmentationId, 'Tumor');
      const kept = makeBoundSegment(segmentationId, 'Node');
      const scalars = artifactScalars(doomed.binding.artifactId);
      scalars[0] = doomed.binding.labelValue;
      scalars[1] = doomed.binding.labelValue;
      scalars[2] = kept.binding.labelValue;

      store().deleteSegment(segmentationId, doomed.id);

      expect([...scalars.slice(0, 3)]).toEqual([0, 0, kept.binding.labelValue]);
      expect(store().segmentations[segmentationId].order).toEqual([kept.id]);
      expect(
        Object.keys(store().segmentations[segmentationId].segments)
      ).toEqual([kept.id]);
    });

    it('releases the artifact only once no binding references it', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');
      const { artifactId } = first.binding;

      store().deleteSegment(segmentationId, first.id);

      expect(Object.keys(store().artifactIndex)).toEqual([artifactId]);
      expect(Object.keys(store().artifactMeta)).toEqual([artifactId]);

      store().deleteSegment(segmentationId, second.id);

      expect(Object.keys(store().artifactIndex)).toEqual([]);
      expect(Object.keys(store().artifactMeta)).toEqual([]);
      expect(store().segmentations[segmentationId].order).toEqual([]);
    });

    it('deletes an unbound segment without allocating storage', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentationId);

      store().deleteSegment(segmentationId, segment.id);

      expect(store().segmentations[segmentationId].order).toEqual([]);
      expect(Object.keys(store().artifactIndex)).toEqual([]);
    });
  });

  describe('removeSegmentation', () => {
    it('drops the segmentation and releases its artifacts', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      makeBoundSegment(segmentationId, 'Tumor');

      store().removeSegmentation(segmentationId);

      expect(Object.keys(store().segmentations)).toEqual([]);
      expect(store().byParentImage).toEqual({});
      expect(store().getSegmentationForImage('img-1')).toBeFalsy();
      expect(Object.keys(store().artifactIndex)).toEqual([]);
      expect(Object.keys(store().artifactMeta)).toEqual([]);
    });
  });

  describe('parent image deletion', () => {
    it('removes the deleted image segmentation and its artifacts', async () => {
      await seatImage('img-1');
      // The store subscribes to image deletion on setup, so instantiate it first.
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      makeBoundSegment(segmentationId, 'Tumor');

      useImageCacheStore().removeImage('img-1');
      await nextTick();

      expect(store().getSegmentationForImage('img-1')).toBeFalsy();
      expect(Object.keys(store().segmentations)).toEqual([]);
      expect(store().byParentImage).toEqual({});
      expect(Object.keys(store().artifactIndex)).toEqual([]);
      expect(Object.keys(store().artifactMeta)).toEqual([]);
    });

    it('leaves other images segmentations alone', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      const doomed = store().ensureSegmentationForImage('img-1').id;
      const kept = store().ensureSegmentationForImage('img-2').id;
      const keptSegment = makeBoundSegment(kept, 'Tumor');
      makeBoundSegment(doomed, 'Tumor');

      useImageCacheStore().removeImage('img-1');
      await nextTick();

      expect(Object.keys(store().segmentations)).toEqual([kept]);
      expect(store().byParentImage).toEqual({ 'img-2': kept });
      expect(Object.keys(store().artifactIndex)).toEqual([
        keptSegment.binding.artifactId,
      ]);
      expect(store().getSegment(kept, keptSegment.id).id).toBe(keptSegment.id);
    });
  });
});
