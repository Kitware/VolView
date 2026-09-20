import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  SPEC_DIMENSIONS as DIMENSIONS,
  maskOn,
  segmentOfMask,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { isEmptyExtent } from '@/src/segmentation/geometry';

const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

async function seatLabelValues(
  id: string,
  values: Uint8Array,
  headerMetadata?: Map<string, string>
) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, `${id}.seg.nrrd`, {
    id,
    headerMetadata,
  });
  await nextTick();
  return id;
}

const store = () => useSegmentationStore();

const segments = () => useSegmentStore().segments;

const mintSegment = (name?: string) =>
  segments().mintSegment(name === undefined ? {} : { name });

const masksOfImage = (parentImageId: string) => {
  const segmentation = store().getSegmentationForImage(parentImageId);
  if (!segmentation) return [];
  return segmentation.order.map((id) => segmentation.masks[id]);
};

const maskScalars = (maskId: string) =>
  store().findMaskBinding(maskId)!.image.getPointData().getScalars().getData();

const boundMasks = () =>
  Object.values(store().segmentations).flatMap((segmentation) =>
    segmentation.order
      .map((id) => segmentation.masks[id])
      .filter((mask) => mask.representations.labelmap)
  );

const labelmapOf = (maskId: string) => store().findMaskVoxels(maskId).image();

const bindingOf = (segmentationId: string, maskId: string) =>
  store().getMask(maskId).representations.labelmap;

function makeBoundSegment(segmentationId: string, name?: string) {
  const segment = store().createMask(segmentationId, mintSegment(name));
  store().ensureLabelmapBinding(segment.id);
  const binding = bindingOf(segmentationId, segment.id)!;
  return { id: segment.id, binding };
}

const oneLabelValues = () => {
  const values = new Uint8Array(VOXEL_COUNT);
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
  await seatImage('parent-img', 'Chest CT');
  // Sequential: each seat awaits its own tick before the next is cached.
  for (const id of childIds) {
    await seatLabelValues(id, values);
  }
};

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
      expect(segmentation.masks).toEqual({});
      expect(segmentation.order).toEqual([]);
      expect(store().getSegmentationForImage('img-1')).toBe(segmentation);
      expect(store().segmentations[segmentation.id]).toBeTruthy();
    });

    it('names a segmentation after its parent image', async () => {
      await seatImage('img-1', 't2_tse_tra');

      const segmentation = store().ensureSegmentationForImage('img-1');

      expect(segmentation.name).toBe('t2_tse_tra');
    });

    it('returns the existing segmentation on a second ensure', async () => {
      await seatImage('img-1');

      const first = store().ensureSegmentationForImage('img-1');
      store().createMask(first.id, mintSegment());
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
      expect(store().getSegmentationForImage('img-1')?.id).toBe(first.id);
      expect(store().getSegmentationForImage('img-2')?.id).toBe(second.id);
    });
  });

  describe('createMask', () => {
    it('needs no storage choice: the binding is absent until it is ensured', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const segment = store().createMask(segmentationId, mintSegment());

      expect(segment.representations.labelmap).toBeUndefined();
      expect(bindingOf(segmentationId, segment.id)).toBeUndefined();
      expect(store().findMaskBinding(segment.id)).toBeFalsy();
      expect(boundMasks()).toEqual([]);
    });

    it('appends the record to the segmentation order', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = store().createMask(segmentationId, mintSegment());
      const second = store().createMask(segmentationId, mintSegment());

      expect(store().segmentations[segmentationId].order).toEqual([
        first.id,
        second.id,
      ]);
      expect(store().getMask(second.id).id).toBe(second.id);
    });

    it('defaults to visible, unlocked records', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const segment = store().createMask(segmentationId, mintSegment());

      // The record is storage; what the user sets lives on its type.
      expect(segments().appearanceOf(segment.segmentId).visible).toBe(true);
      expect(segments().appearanceOf(segment.segmentId).locked).toBe(false);
    });

    it('gives a record its own id, distinct from the type it references', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segmentId = mintSegment('Tumor');

      const segment = store().createMask(segmentationId, segmentId);

      expect(segment.segmentId).toBe(segmentId);
      expect(segment.id).not.toBe(segmentId);
      expect(segments().appearanceOf(segment.segmentId).name).toBe('Tumor');
    });

    it('holds no identity of its own', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segmentId = mintSegment('Tumor');
      const segment = store().createMask(segmentationId, segmentId);

      segments().updateSegment(segmentId, { name: 'Lesion' });

      expect(store().getMask(segment.id).segmentId).toBe(segmentId);
      expect(segments().appearanceOf(segment.segmentId).name).toBe('Lesion');
    });

    it('lets two images hold a record for one type', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      const segmentId = mintSegment('Tumor');

      const first = maskOn('img-1', segmentId);
      const second = maskOn('img-2', segmentId);

      expect(second.id).not.toBe(first.id);
      expect(second.segmentId).toBe(first.segmentId);
    });

    it('keeps one record per type on an image', async () => {
      await seatImage('img-1');
      const segmentId = mintSegment('Tumor');

      const first = maskOn('img-1', segmentId);
      const again = maskOn('img-1', segmentId);

      expect(again.id).toBe(first.id);
      expect(store().getSegmentationForImage('img-1')!.order).toEqual([
        first.id,
      ]);
    });
  });

  describe('ensureLabelmapBinding', () => {
    it('allocates one mask on the parent image for the segment', async () => {
      await seatImage('img-1', 'Chest CT');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { id: maskId, binding } = makeBoundSegment(segmentationId);

      expect(boundMasks().map((mask) => mask.id)).toEqual([maskId]);
      expect(store().segmentationOfMask(maskId)?.parentImageId).toBe('img-1');
      expect(binding.name.length).toBeGreaterThan(0);
    });

    it('covers nothing until an edit says what to cover', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { id: maskId, binding } = makeBoundSegment(segmentationId);

      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect([...binding.image.getDimensions()]).toEqual([0, 0, 0]);
      expect(maskScalars(maskId)).toHaveLength(0);
    });

    it('allocates a nonzero label value', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect(binding.image).toBeDefined();
    });

    it('returns the same binding on a second call and allocates nothing new', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segment = store().createMask(segmentationId, mintSegment());

      const first = store().ensureLabelmapBinding(segment.id);
      const second = store().ensureLabelmapBinding(segment.id);

      expect(second).toBe(first);
      expect(boundMasks()).toHaveLength(1);
    });

    it('gives two segments of one segmentation their own mask', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      expect(second.binding.image).not.toBe(first.binding.image);
      expect(boundMasks()).toHaveLength(2);
    });

    it('resolves a binding to its storage', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const { id: maskId, binding } = makeBoundSegment(segmentationId);

      expect(store().findMaskVoxels(maskId).image()).toBe(binding.image);
    });
  });

  describe('stable identity', () => {
    it('keeps mask ids and bindings across a rename, a recolor and a reorder', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      segments().updateSegment(store().getMask(first.id).segmentId, {
        name: 'Primary tumor',
        color: [7, 8, 9, 255],
      });
      useSegmentStore().segments.updateSegment(segmentOfMask(first.id), {
        visible: false,
        locked: true,
      });
      segments().moveSegment(segmentOfMask(second.id), segmentOfMask(first.id));

      const renamed = store().getMask(first.id);
      expect(renamed.id).toBe(first.id);
      expect(segments().appearanceOf(renamed.segmentId).name).toBe(
        'Primary tumor'
      );
      expect([...segments().appearanceOf(renamed.segmentId).color]).toEqual([
        7, 8, 9, 255,
      ]);
      expect(segments().appearanceOf(renamed.segmentId).visible).toBe(false);
      expect(segments().appearanceOf(renamed.segmentId).locked).toBe(true);
      expect(renamed.representations.labelmap).toEqual(first.binding);
      expect(store().getMask(second.id).id).toBe(second.id);
      expect(store().maskLayersForImage('img-1')).toEqual([
        { maskId: first.id, stackIndex: 0 },
        { maskId: second.id, stackIndex: 1 },
      ]);
    });

    it('leaves other records untouched when one is updated', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = store().createMask(segmentationId, mintSegment('Tumor'));
      const second = store().createMask(segmentationId, mintSegment('Node'));

      segments().updateSegment(first.segmentId, { visible: false });

      expect(segments().appearanceOf(second.segmentId).visible).toBe(true);
      expect(
        segments().appearanceOf(store().getMask(second.id).segmentId).name
      ).toBe('Node');
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

      expect(second.binding.image).not.toBe(first.binding.image);
      expect(second.id).not.toBe(first.id);
      expect(store().getMask(first.id).id).toBe(first.id);
      expect(store().getMask(second.id).id).toBe(second.id);
      expect(labelmapOf(first.id)).not.toBe(labelmapOf(second.id));
    });
  });

  describe('segment count', () => {
    // Masks are per segment and all hold SEGMENT_VALUE, so nothing is
    // allocated against a per-image pool and an import past 255 is ordinary.
    it('imports past the one-byte label cap', async () => {
      await seatImage('parent-img', 'Chest CT');
      const segmentation = store().ensureSegmentationForImage('parent-img');
      for (let n = 0; n < 254; n += 1) makeBoundSegment(segmentation.id);
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      values.fill(2, 12);
      await seatLabelValues('child-img', values);

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const masks = masksOfImage('parent-img');
      expect(masks).toHaveLength(256);
      expect(masks.every((segment) => segment.representations.labelmap)).toBe(
        true
      );
    });
  });

  describe('deleteMask', () => {
    it('leaves the neighbour mask alone', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const doomed = makeBoundSegment(segmentationId, 'Tumor');
      const kept = makeBoundSegment(segmentationId, 'Node');
      store().maskVoxels(kept.id).ensureContains([0, 0, 0, 0, 0, 0]);
      store().maskVoxels(kept.id).scalars()[0] = SEGMENT_VALUE;

      store().deleteMask(doomed.id);

      expect([...store().maskVoxels(kept.id).scalars()]).toEqual([
        SEGMENT_VALUE,
      ]);
      expect(store().segmentations[segmentationId].order).toEqual([kept.id]);
      expect(Object.keys(store().segmentations[segmentationId].masks)).toEqual([
        kept.id,
      ]);
    });

    it('releases the segment mask with the segment', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      store().deleteMask(first.id);

      expect(boundMasks().map((mask) => mask.id)).toEqual([second.id]);

      store().deleteMask(second.id);

      expect(boundMasks()).toEqual([]);
      expect(store().segmentations[segmentationId].order).toEqual([]);
    });

    it('deletes an unbound segment without allocating storage', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segment = store().createMask(segmentationId, mintSegment());

      store().deleteMask(segment.id);

      expect(store().segmentations[segmentationId].order).toEqual([]);
      expect(boundMasks()).toEqual([]);
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
      expect(store().getSegmentationForImage('img-1')).toBeFalsy();
      expect(boundMasks()).toEqual([]);
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
      expect(boundMasks()).toEqual([]);
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
      expect(store().getSegmentationForImage('img-2')?.id).toBe(kept);
      expect(boundMasks().map((mask) => mask.id)).toEqual([keptSegment.id]);
      expect(store().getMask(keptSegment.id).id).toBe(keptSegment.id);
    });
  });

  describe('conversion and decode', () => {
    it('reports the source image while its conversion is pending', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      const conversion = store().convertImageToLabelmap(
        'child-img',
        'parent-img'
      );

      expect(store().convertingLabelmaps.has('child-img')).toBe(true);
      await conversion;
      expect(store().convertingLabelmaps.has('child-img')).toBe(false);
    });

    it('joins a conversion already running for the same image', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      // Two entry points fire without awaiting: a load starts one and the
      // browser's Convert button starts the other before the first settles.
      const first = store().convertImageToLabelmap('child-img', 'parent-img');
      const second = store().convertImageToLabelmap('child-img', 'parent-img');

      expect(store().convertingLabelmaps.has('child-img')).toBe(true);
      const [firstResult, secondResult] = await Promise.all([first, second]);
      // The image reports converting until the one conversion really ends.
      expect(store().convertingLabelmaps.has('child-img')).toBe(false);

      // One split, so one segment per label value and no suffixed duplicates.
      expect(secondResult).toEqual(firstResult);
      const masks = masksOfImage('parent-img');
      expect(
        masks.map((mask) => segments().appearanceOf(mask.segmentId).name)
      ).toEqual(['child-img 1', 'child-img 2']);
    });

    it('converts the same image again once the first conversion ended', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      await store().convertImageToLabelmap('child-img', 'parent-img');
      await store().convertImageToLabelmap('child-img', 'parent-img');

      // A second, separate conversion still adds its own segments: the guard
      // only joins calls that overlap.
      expect(masksOfImage('parent-img')).toHaveLength(4);
    });

    it('creates one bound segment per discovered label value', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const segmentation = store().getSegmentationForImage('parent-img');
      expect(segmentation).toBeTruthy();
      expect(segmentation!.parentImageId).toBe('parent-img');
      const masks = masksOfImage('parent-img');
      // The fixture files the child as `child-img.seg.nrrd`, and an
      // undescribed value names after the file it arrived in.
      expect(
        masks.map((mask) => segments().appearanceOf(mask.segmentId).name)
      ).toEqual(['child-img 1', 'child-img 2']);
      masks.forEach((segment) => {
        const appearance = segments().appearanceOf(segment.segmentId);
        expect(appearance.visible).toBe(true);
        expect(appearance.locked).toBe(false);
        expect(segment.id.length).toBeGreaterThan(0);
      });
    });

    it('binds each converted segment to a mask holding its own voxels', async () => {
      await seatConversionSources(['child-img'], twoLabelValues());

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const masks = masksOfImage('parent-img');
      expect(masks).toHaveLength(2);
      const [first, second] = masks.map(
        (segment) => segment.representations.labelmap!
      );
      expect(second.image).not.toBe(first.image);
      expect(labelmapOf(masks[0].id)).toBe(first.image);
      // Each mask holds exactly one nonzero value, its segment's.
      expect(new Set(maskScalars(masks[0].id))).toEqual(
        new Set([SEGMENT_VALUE])
      );
      expect(new Set(maskScalars(masks[1].id))).toEqual(
        new Set([0, SEGMENT_VALUE])
      );
      expect(store().segmentationOfMask(masks[0].id)?.parentImageId).toBe(
        'parent-img'
      );
      expect(first.name.length).toBeGreaterThan(0);
    });

    it('preserves names and colors from embedded seg.nrrd metadata', async () => {
      await seatImage('parent-img', 'Chest CT');
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      values.fill(2, 12);
      await seatLabelValues(
        'child-img',
        values,
        new Map([
          ['Segment0_LabelValue', '2'],
          ['Segment0_Name', 'Tumor core'],
          ['Segment0_Color', '1 0 0'],
        ])
      );

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const masks = masksOfImage('parent-img');
      expect(masks).toHaveLength(2);
      // The split walks the source values in ascending order, so a mask's
      // place says which value in the imported file it came from.
      const appearanceOf = (sourceValue: number) =>
        segments().appearanceOf(masks[sourceValue - 1].segmentId);
      expect(appearanceOf(2).name).toBe('Tumor core');
      expect([...appearanceOf(2).color]).toEqual([255, 0, 0, 255]);
      // Merge, not replace: an undescribed value keeps its default.
      expect(appearanceOf(1).name).toBe('child-img 1');
    });

    it('gives a second conversion of the same parent its own segments', async () => {
      await seatConversionSources(['child-a', 'child-b'], oneLabelValues());
      const segmentGroups = store();

      await segmentGroups.convertImageToLabelmap('child-a', 'parent-img');
      await segmentGroups.convertImageToLabelmap('child-b', 'parent-img');

      expect(Object.keys(store().segmentations)).toHaveLength(1);
      const masks = masksOfImage('parent-img');
      expect(masks).toHaveLength(2);
      expect(masks[1].id).not.toBe(masks[0].id);
      expect(masks[1].representations.labelmap!.image).not.toBe(
        masks[0].representations.labelmap!.image
      );
    });

    it('reports which segment each source label value became', async () => {
      await seatConversionSources(['child-a', 'child-b'], oneLabelValues());
      const segmentGroups = store();

      await segmentGroups.convertImageToLabelmap('child-a', 'parent-img');
      const [second] = await segmentGroups.convertImageToLabelmap(
        'child-b',
        'parent-img'
      );

      // Both imports carry source value 1 and both masks hold SEGMENT_VALUE,
      // so only the report says which segment the second import became.
      const masks = masksOfImage('parent-img');
      expect(second).toEqual([{ sourceValue: 1, maskId: masks[1].id }]);
    });

    it('enumerates no segments for an all-background labelmap', async () => {
      await seatImage('parent-img', 'Chest CT');
      await seatLabelValues('child-img', new Uint8Array(VOXEL_COUNT));

      await store().convertImageToLabelmap('child-img', 'parent-img');

      expect(masksOfImage('parent-img')).toEqual([]);
      expect(boundMasks()).toEqual([]);
    });
  });

  describe('edit targets', () => {
    async function seatTwoImages() {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      return {
        one: store().ensureSegmentationForImage('img-1').id,
        two: store().ensureSegmentationForImage('img-2').id,
      };
    }

    const maskOf = (maskId: string) => store().getMask(maskId);

    it('creates nothing when a type is selected', async () => {
      const { one, two } = await seatTwoImages();
      segments().addSegment({ name: 'Tumor' });

      expect(store().segmentations[one].order).toEqual([]);
      expect(store().segmentations[two].order).toEqual([]);
      expect(boundMasks()).toEqual([]);
    });

    it('creates no segmentation for an image that has none', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      const one = store().ensureSegmentationForImage('img-1').id;
      segments().addSegment({ name: 'Tumor' });

      expect(store().getSegmentationForImage('img-2')).toBeFalsy();
      expect(Object.keys(store().segmentations)).toEqual([one]);
    });

    it('resolves the selected type to this image record', async () => {
      const { one } = await seatTwoImages();
      const segmentId = segments().addSegment({ name: 'Tumor' });
      const record = maskOn('img-1', segmentId);

      const target = store().resolveEditTarget('img-1');

      expect(target).toBe(record.id);
      expect(store().segmentations[one].order).toEqual([record.id]);
    });

    it('gives the second image its own record for the selected type', async () => {
      const { one, two } = await seatTwoImages();
      const segmentId = segments().addSegment({ name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');

      const target = store().resolveEditTarget('img-2');

      expect(target).not.toBe(source);
      expect(maskOf(target).segmentId).toBe(segmentId);
      expect(maskOf(source).segmentId).toBe(segmentId);
      expect(store().segmentations[two].order).toEqual([target]);
      expect(store().segmentations[one].order).toEqual([source]);
    });

    it('reuses each image record for the rest of the session', async () => {
      const { one, two } = await seatTwoImages();
      segments().addSegment({ name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');

      const first = store().resolveEditTarget('img-2');
      const back = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(back).toBe(source);
      expect(second).toBe(first);
      expect(store().segmentations[two].order).toEqual([first]);
      expect(store().segmentations[one].order).toEqual([source]);
    });

    it('renames every image record at once, because they share one type', async () => {
      await seatTwoImages();
      const segmentId = segments().addSegment({ name: 'Tumor' });
      const source = store().resolveEditTarget('img-1');
      const target = store().resolveEditTarget('img-2');

      segments().updateSegment(segmentId, { name: 'Lesion' });

      expect(segments().appearanceOf(maskOf(source).segmentId).name).toBe(
        'Lesion'
      );
      expect(segments().appearanceOf(maskOf(target).segmentId).name).toBe(
        'Lesion'
      );
    });

    it('never binds a second record of one type to an image', async () => {
      const { two } = await seatTwoImages();
      const segmentId = segments().addSegment({ name: 'Tumor' });
      const existing = maskOn('img-2', segmentId);

      const target = store().resolveEditTarget('img-2');

      expect(target).toBe(existing.id);
      expect(store().segmentations[two].order).toEqual([existing.id]);
    });

    it('creates a record again when the one it had was deleted', async () => {
      const { two } = await seatTwoImages();
      segments().addSegment({ name: 'Tumor' });
      const first = store().resolveEditTarget('img-2');

      store().deleteMask(first);
      const second = store().resolveEditTarget('img-2');

      expect(store().segmentations[two].masks[second]).toBeDefined();
      expect(second).not.toBe(first);
      expect(store().segmentations[two].order).toEqual([second]);
    });

    it('follows the selection to another type', async () => {
      const { one } = await seatTwoImages();
      const tumor = segments().addSegment({ name: 'Tumor' });
      const node = segments().addSegment({ name: 'Node' });

      segments().selectSegment(tumor);
      const forTumor = store().resolveEditTarget('img-1');
      segments().selectSegment(node);
      const forNode = store().resolveEditTarget('img-1');

      expect(forNode).not.toBe(forTumor);
      expect(maskOf(forNode).segmentId).toBe(node);
      expect(maskOf(forTumor).segmentId).toBe(tumor);
      expect(store().segmentations[one].order).toEqual([forTumor, forNode]);
    });

    it('mints and selects a type on the first edit of a session', async () => {
      await seatImage('img-1');

      const target = store().resolveEditTarget('img-1');

      const segmentation = store().getSegmentationForImage('img-1');
      expect(segmentation!.order).toEqual([target]);
      const segment = maskOf(target);
      const appearance = segments().appearanceOf(segment.segmentId);
      expect(appearance.visible).toBe(true);
      expect(appearance.locked).toBe(false);
      expect(segments().selectedSegmentId.value).toBe(segment.segmentId);
      expect(segments().appearanceOf(segment.segmentId).name).toBe('Segment 1');
    });

    it('uses a unique default name after the selected type is deleted', async () => {
      await seatImage('img-1');
      const first = store().resolveEditTarget('img-1');
      const selected = segments().addSegment();
      segments().deleteSegment(selected);

      const replacement = store().resolveEditTarget('img-1');

      expect(replacement).toBe(first);
      expect(segments().appearanceOf(maskOf(first).segmentId).name).toBe(
        'Segment 1'
      );
      // The next minted type takes the next free default name.
      expect(segments().appearanceOf(segments().addSegment()).name).toBe(
        'Segment 2'
      );
    });

    it('binds the minted record to storage for its own image', async () => {
      await seatImage('img-1');

      const target = store().resolveEditTarget('img-1');
      const binding = store().ensureLabelmapBinding(target);

      expect(store().segmentationOfMask(target)?.parentImageId).toBe('img-1');
      expect(labelmapOf(target)).toBe(binding.image);
    });

    it('gives each image its own record when nothing was ever selected', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');

      const first = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(second).not.toBe(first);
      expect(store().getSegmentationForImage('img-2')!.order).toEqual([second]);
    });

    it('finds no target for a type this image has no record for', async () => {
      await seatImage('img-1');
      segments().addSegment({ name: 'Tumor' });

      expect(store().findEditTarget('img-1')).toBeUndefined();
      expect(store().getSegmentationForImage('img-1')).toBeFalsy();
    });
  });
});
