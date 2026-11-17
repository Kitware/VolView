import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatImage,
  seatSpecImage,
  SPEC_DIMENSIONS,
  SPEC_VOXEL_COUNT,
  bindingOf,
  boundMasks,
  deleteSegment,
  mintSegment,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { useImageCacheStore } from '@/src/store/image-cache';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useLabelmapImportStore } from '@/src/segmentation/io/labelmapImport';

const segments = () => useSegmentStore().segments;

const labelmapOf = (segmentId: string) =>
  store().findMaskVoxels(segmentId).image();

function makeBoundSegment(imageId: string, name?: string) {
  const id = mintSegment(imageId, name);
  const binding = store().materializeMask(id);
  return { id, binding };
}

const maskedSegments = (imageId: string) =>
  store()
    .imageMasks(imageId)
    .map(({ segmentId }) => segmentId);

const segmentIdsOf = (imageId: string) =>
  segments()
    .segmentList(imageId)
    .map(({ id }) => id);

const oneLabelValues = () => {
  const values = new Uint8Array(SPEC_VOXEL_COUNT);
  values.fill(1, 4, 12);
  return values;
};

const twoLabelValues = () => {
  const values = oneLabelValues();
  values.fill(2, 12);
  return values;
};

const seatConversionSources = async (
  childIds: string[],
  values: Uint8Array
) => {
  await seatSpecImage('parent-img', 'Chest CT');
  // Sequential: each seat awaits its own tick before the next is cached.
  for (const id of childIds) {
    await seatImage(id, {
      name: `${id}.seg.nrrd`,
      dimensions: SPEC_DIMENSIONS,
      values,
    });
  }
};

describe('segmentation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('masks per parent image', () => {
    it('holds no masks for an image until one is allocated', async () => {
      await seatSpecImage('img-1');

      expect(store().imageMasks('img-1')).toEqual([]);
      const segmentId = mintSegment('img-1');
      expect(store().imageMasks('img-1')).toEqual([]);

      store().materializeMask(segmentId);

      expect(maskedSegments('img-1')).toEqual([segmentId]);
    });

    it('names a segmentation after its parent image', async () => {
      await seatSpecImage('img-1', 't2_tse_tra');

      expect(store().segmentationName('img-1')).toBe('t2_tse_tra');
    });

    it('keeps separate masks for separate images', async () => {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');

      const first = makeBoundSegment('img-1');
      const second = makeBoundSegment('img-2');

      expect(maskedSegments('img-1')).toEqual([first.id]);
      expect(maskedSegments('img-2')).toEqual([second.id]);
    });
  });

  describe('segment masks', () => {
    it('needs no storage choice: the mask is absent until it is materialized', async () => {
      await seatSpecImage('img-1');

      const segmentId = mintSegment('img-1');

      expect(bindingOf(segmentId)).toBeUndefined();
      expect(boundMasks()).toEqual([]);
    });

    it('walks masks in segment order', async () => {
      await seatSpecImage('img-1');

      const first = makeBoundSegment('img-1');
      const second = makeBoundSegment('img-1');

      expect(maskedSegments('img-1')).toEqual([first.id, second.id]);
      expect(bindingOf(second.id)).toBe(second.binding);
    });

    it('defaults to visible, unlocked segments', async () => {
      await seatSpecImage('img-1');

      const segmentId = mintSegment('img-1');

      expect(segments().appearanceOf(segmentId).visible).toBe(true);
      expect(segments().appearanceOf(segmentId).locked).toBe(false);
    });

    it('holds no identity of its own', async () => {
      await seatSpecImage('img-1');
      const { id: segmentId, binding } = makeBoundSegment('img-1', 'Tumor');

      segments().updateSegment(segmentId, { name: 'Lesion' });

      expect(bindingOf(segmentId)).toBe(binding);
      expect(segments().appearanceOf(segmentId).name).toBe('Lesion');
    });

    it('refuses using one image segment on another image', async () => {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');
      const { id: segmentId, binding } = makeBoundSegment('img-1', 'Tumor');

      expect(() => store().resolveEditTarget('img-2', segmentId)).toThrow(
        'Segment belongs to another image'
      );
      expect(store().imageMasks('img-2')).toEqual([]);
      expect(bindingOf(segmentId)).toBe(binding);
    });

    it('keeps one mask per segment on an image', async () => {
      await seatSpecImage('img-1');
      const segmentId = mintSegment('img-1', 'Tumor');

      const first = store().materializeMask(segmentId);
      const again = store().materializeMask(segmentId);

      expect(again).toBe(first);
      expect(maskedSegments('img-1')).toEqual([segmentId]);
    });

    it('refuses a second mask for a segment', async () => {
      await seatSpecImage('img-1');
      const { id: segmentId, binding } = makeBoundSegment('img-1', 'Tumor');

      expect(() =>
        store().allocateSegmentMask(segmentId, [0, 0, 0, 0, 0, 0])
      ).toThrow('Segment already has a mask');
      expect(bindingOf(segmentId)).toBe(binding);
      expect(maskedSegments('img-1')).toEqual([segmentId]);
    });

    it('refuses a mask for a segment that does not exist', async () => {
      await seatSpecImage('img-1');

      expect(() =>
        store().allocateSegmentMask('nope', [0, 0, 0, 0, 0, 0])
      ).toThrow('No such segment');
      expect(() => store().maskVoxels('nope')).toThrow('No such segment');
      expect(boundMasks()).toEqual([]);
    });
  });

  describe('materializeMask', () => {
    it('allocates one mask on the parent image for the segment', async () => {
      await seatSpecImage('img-1', 'Chest CT');

      const { id: segmentId } = makeBoundSegment('img-1');

      expect(boundMasks().map((mask) => mask.segmentId)).toEqual([segmentId]);
      expect(maskedSegments('img-1')).toEqual([segmentId]);
    });
  });

  describe('stable identity', () => {
    it('keeps segment ids and bindings across a rename, a recolor and a reorder', async () => {
      await seatSpecImage('img-1');
      const first = makeBoundSegment('img-1', 'Tumor');
      const second = makeBoundSegment('img-1', 'Node');

      segments().updateSegment(first.id, {
        name: 'Primary tumor',
        color: [7, 8, 9, 255],
      });
      segments().updateSegment(first.id, { visible: false, locked: true });
      segments().moveSegment(second.id, first.id);

      expect(segments().appearanceOf(first.id).name).toBe('Primary tumor');
      expect([...segments().appearanceOf(first.id).color]).toEqual([
        7, 8, 9, 255,
      ]);
      expect(segments().appearanceOf(first.id).visible).toBe(false);
      expect(segments().appearanceOf(first.id).locked).toBe(true);
      expect(bindingOf(first.id)).toBe(first.binding);
      expect(bindingOf(second.id)).toBe(second.binding);
      // Masks walk in segment order, so the move reorders them too.
      expect(segmentIdsOf('img-1')).toEqual([second.id, first.id]);
      expect(maskedSegments('img-1')).toEqual([second.id, first.id]);
    });

    it('leaves other segments untouched when one is updated', async () => {
      await seatSpecImage('img-1');
      const first = mintSegment('img-1', 'Tumor');
      const second = mintSegment('img-1', 'Node');

      segments().updateSegment(first, { visible: false });

      expect(segments().appearanceOf(second).visible).toBe(true);
      expect(segments().appearanceOf(second).name).toBe('Node');
    });
  });

  describe('same-named segments on two images', () => {
    it('keep their own masks and storage', async () => {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');

      const first = makeBoundSegment('img-1', 'Tumor');
      const second = makeBoundSegment('img-2', 'Tumor');

      expect(second.binding.image).not.toBe(first.binding.image);
      expect(second.id).not.toBe(first.id);
      expect(bindingOf(first.id)).toBe(first.binding);
      expect(bindingOf(second.id)).toBe(second.binding);
      expect(labelmapOf(first.id)).not.toBe(labelmapOf(second.id));
    });
  });

  describe('deleting a segment', () => {
    it('leaves the neighbor mask alone', async () => {
      await seatSpecImage('img-1');
      const doomed = makeBoundSegment('img-1', 'Tumor');
      const kept = makeBoundSegment('img-1', 'Node');
      store().maskVoxels(kept.id).ensureContains([0, 0, 0, 0, 0, 0]);
      store().maskVoxels(kept.id).scalars()[0] = SEGMENT_VALUE;

      deleteSegment(doomed.id);

      expect([...store().maskVoxels(kept.id).scalars()]).toEqual([
        SEGMENT_VALUE,
      ]);
      expect(maskedSegments('img-1')).toEqual([kept.id]);
      expect(bindingOf(doomed.id)).toBeUndefined();
    });

    it('releases the segment mask with the segment', async () => {
      await seatSpecImage('img-1');
      const first = makeBoundSegment('img-1', 'Tumor');
      const second = makeBoundSegment('img-1', 'Node');

      deleteSegment(first.id);

      expect(boundMasks().map((mask) => mask.segmentId)).toEqual([second.id]);

      deleteSegment(second.id);

      expect(boundMasks()).toEqual([]);
      expect(segmentIdsOf('img-1')).toEqual([]);
    });

    it('deletes a maskless segment without allocating storage', async () => {
      await seatSpecImage('img-1');
      const segmentId = mintSegment('img-1');

      deleteSegment(segmentId);

      expect(segmentIdsOf('img-1')).toEqual([]);
      expect(boundMasks()).toEqual([]);
    });
  });

  describe('parent image deletion', () => {
    it("removes the deleted image's segments and their masks", async () => {
      await seatSpecImage('img-1');
      // The store subscribes to image deletion on setup, so instantiate it first.
      makeBoundSegment('img-1', 'Tumor');

      useImageCacheStore().removeImage('img-1');

      expect(segmentIdsOf('img-1')).toEqual([]);
      expect(boundMasks()).toEqual([]);
    });

    it('leaves other images masks alone', async () => {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');
      const keptSegment = makeBoundSegment('img-2', 'Tumor');
      makeBoundSegment('img-1', 'Tumor');

      useImageCacheStore().removeImage('img-1');

      expect(boundMasks().map((mask) => mask.segmentId)).toEqual([
        keptSegment.id,
      ]);
      expect(bindingOf(keptSegment.id)).toBe(keptSegment.binding);
    });
  });

  describe('conversion and decode', () => {
    it('reports the source image while its conversion is pending', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      const conversion = useLabelmapImportStore().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );

      expect(
        useLabelmapImportStore().convertingLabelmaps.has('child-img')
      ).toBe(true);
      await conversion;
      expect(
        useLabelmapImportStore().convertingLabelmaps.has('child-img')
      ).toBe(false);
    });

    it('joins a conversion already running for the same image', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      // Two entry points fire without awaiting: a load starts one and the
      // browser's Convert button starts the other before the first settles.
      const first = useLabelmapImportStore().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );
      const second = useLabelmapImportStore().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );

      expect(
        useLabelmapImportStore().convertingLabelmaps.has('child-img')
      ).toBe(true);
      const [firstResult, secondResult] = await Promise.all([first, second]);
      // The image reports converting until the one conversion really ends.
      expect(
        useLabelmapImportStore().convertingLabelmaps.has('child-img')
      ).toBe(false);

      // One split, so one segment per label value and no suffixed duplicates.
      expect(secondResult).toEqual(firstResult);
      const masks = store().imageMasks('parent-img');
      expect(
        masks.map((mask) => segments().appearanceOf(mask.segmentId).name)
      ).toEqual(['child-img 1', 'child-img 2']);
    });

    it('converts the same image again once the first conversion ended', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      await useLabelmapImportStore().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );
      await useLabelmapImportStore().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );

      // A second, separate conversion still adds its own segments: the guard
      // only joins calls that overlap.
      expect(store().imageMasks('parent-img')).toHaveLength(4);
    });

    it('gives a second conversion of the same parent its own segments', async () => {
      await seatConversionSources(['child-a', 'child-b'], oneLabelValues());

      await useLabelmapImportStore().convertImageToLabelmap(
        'child-a',
        'parent-img'
      );
      await useLabelmapImportStore().convertImageToLabelmap(
        'child-b',
        'parent-img'
      );

      const masks = store().imageMasks('parent-img');
      expect(masks).toHaveLength(2);
      expect(masks[1].segmentId).not.toBe(masks[0].segmentId);
      expect(masks[1].binding.image).not.toBe(masks[0].binding.image);
    });

    it('reports which segment each source label value became', async () => {
      await seatConversionSources(['child-a', 'child-b'], oneLabelValues());

      await useLabelmapImportStore().convertImageToLabelmap(
        'child-a',
        'parent-img'
      );
      const [second] = await useLabelmapImportStore().convertImageToLabelmap(
        'child-b',
        'parent-img'
      );

      // Both imports carry source value 1 and both masks hold SEGMENT_VALUE,
      // so only the report says which segment the second import became.
      const masks = store().imageMasks('parent-img');
      expect(second).toEqual([
        { sourceValue: 1, segmentId: masks[1].segmentId },
      ]);
    });
  });

  describe('edit targets', () => {
    async function seatTwoImages() {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');
    }

    it('creates nothing when a segment is selected', async () => {
      await seatTwoImages();
      segments().addSegment('img-1', { name: 'Tumor' });

      expect(segmentIdsOf('img-2')).toEqual([]);
      expect(boundMasks()).toEqual([]);
    });

    it('resolves the selected segment of this image without allocating', async () => {
      await seatTwoImages();
      const segmentId = segments().addSegment('img-1', { name: 'Tumor' });

      const target = store().resolveEditTarget('img-1');

      expect(target).toBe(segmentId);
      expect(boundMasks()).toEqual([]);
    });

    it('gives the second image its own segment', async () => {
      await seatTwoImages();
      const segmentId = segments().addSegment('img-1', { name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');

      const target = store().resolveEditTarget('img-2');

      expect(source).toBe(segmentId);
      expect(target).not.toBe(source);
      expect(segmentIdsOf('img-2')).toEqual([target]);
      expect(segmentIdsOf('img-1')).toEqual([source]);
    });

    it('reuses each image segment for the rest of the session', async () => {
      await seatTwoImages();
      segments().addSegment('img-1', { name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');

      const first = store().resolveEditTarget('img-2');
      const back = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(back).toBe(source);
      expect(second).toBe(first);
      expect(segmentIdsOf('img-2')).toEqual([first]);
      expect(segmentIdsOf('img-1')).toEqual([source]);
    });

    it('renames only the owning image segment', async () => {
      await seatTwoImages();
      const segmentId = segments().addSegment('img-1', { name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');
      const target = store().resolveEditTarget('img-2');

      segments().updateSegment(segmentId, { name: 'Lesion' });

      expect(segments().appearanceOf(source).name).toBe('Lesion');
      expect(segments().appearanceOf(target).name).toBe('Segment 1');
    });

    it('never allocates a second mask of one segment on an image', async () => {
      await seatTwoImages();
      const { id: segmentId, binding } = makeBoundSegment('img-2', 'Tumor');

      const target = store().resolveEditTarget('img-2');

      expect(target).toBe(segmentId);
      expect(store().materializeMask(target)).toBe(binding);
      expect(maskedSegments('img-2')).toEqual([segmentId]);
    });

    it('mints a segment again when its segment was deleted', async () => {
      await seatTwoImages();
      const tumor = segments().addSegment('img-2', { name: 'Tumor' });
      const first = store().resolveEditTarget('img-2');

      deleteSegment(first);
      const second = store().resolveEditTarget('img-2');

      expect(first).toBe(tumor);
      expect(second).not.toBe(tumor);
      expect(segmentIdsOf('img-2')).toEqual([second]);
    });

    it('follows the selection to another segment', async () => {
      await seatTwoImages();
      const tumor = segments().addSegment('img-1', { name: 'Tumor' });
      const node = segments().addSegment('img-1', { name: 'Node' });

      segments().selectSegment(tumor);
      const forTumor = store().resolveEditTarget('img-1');
      segments().selectSegment(node);
      const forNode = store().resolveEditTarget('img-1');

      expect(forTumor).toBe(tumor);
      expect(forNode).toBe(node);
      expect(boundMasks()).toEqual([]);
    });

    it('mints and selects a segment on the first edit of a session', async () => {
      await seatSpecImage('img-1');

      const target = store().resolveEditTarget('img-1');

      expect(segmentIdsOf('img-1')).toEqual([target]);
      const appearance = segments().appearanceOf(target);
      expect(appearance.visible).toBe(true);
      expect(appearance.locked).toBe(false);
      expect(segments().selectedSegmentId('img-1')).toBe(target);
      expect(appearance.name).toBe('Segment 1');
    });

    it('falls back to the first segment and reuses the freed default name', async () => {
      await seatSpecImage('img-1');
      const first = store().resolveEditTarget('img-1');
      const selected = segments().addSegment('img-1');
      segments().deleteSegment(selected);

      const replacement = store().resolveEditTarget('img-1');

      expect(replacement).toBe(first);
      expect(segments().appearanceOf(first).name).toBe('Segment 1');
      // The next minted segment takes the next free default name.
      expect(segments().appearanceOf(segments().addSegment('img-1')).name).toBe(
        'Segment 2'
      );
    });

    it('binds the minted segment to storage for its own image', async () => {
      await seatSpecImage('img-1');

      const target = store().resolveEditTarget('img-1');
      const binding = store().materializeMask(target);

      expect(maskedSegments('img-1')).toEqual([target]);
      expect(labelmapOf(target)).toBe(binding.image);
    });

    it('gives each image its own segment when nothing was ever selected', async () => {
      await seatSpecImage('img-1');
      await seatSpecImage('img-2', 'PET');

      const first = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(second).not.toBe(first);
      expect(segmentIdsOf('img-2')).toEqual([second]);
    });

    it('finds no target for a segment this image has no mask for', async () => {
      await seatSpecImage('img-1');
      segments().addSegment('img-1', { name: 'Tumor' });

      expect(store().findEditTarget('img-1')).toBeUndefined();
      expect(store().imageMasks('img-1')).toEqual([]);
    });

    it('targets the first segment while none has been chosen', async () => {
      await seatTwoImages();
      const first = makeBoundSegment('img-1', 'Tumor');
      makeBoundSegment('img-1', 'Node');

      expect(store().findEditTarget('img-1')).toBe(first.id);
    });

    it('asks the lock of the segment it targets', async () => {
      await seatTwoImages();
      const first = makeBoundSegment('img-1', 'Tumor');
      const second = makeBoundSegment('img-1', 'Node');
      segments().updateSegment(first.id, { locked: true });

      expect(store().editTargetLocked('img-1')).toBe(true);

      segments().selectSegment(second.id);

      expect(store().editTargetLocked('img-1')).toBe(false);
      expect(store().findEditTarget('img-1')).toBe(second.id);
    });
  });
});
