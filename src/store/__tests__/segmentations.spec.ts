import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { CATEGORICAL_COLORS, DEFAULT_SEGMENT_MASKS } from '@/src/config';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { isEmptyExtent } from '@/src/types/segmentation';

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

/** Seats a child image whose voxels already carry label values. */
async function seatLabelValues(
  id: string,
  values: Uint8Array,
  headerMetadata?: Map<string, string>
) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
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

/** The image's segments, in order. */
const segmentsOfImage = (parentImageId: string) => {
  const segmentation = store().getSegmentationForImage(parentImageId);
  if (!segmentation) return [];
  return segmentation.order.map((id) => segmentation.segments[id]);
};

const labelValuesOf = (segments: ReturnType<typeof segmentsOfImage>) =>
  segments.map((segment) => segment.representations.labelmap!.labelValue);

const artifactScalars = (artifactId: string) =>
  store().artifactIndex[artifactId].getPointData().getScalars().getData();

const bindingOf = (segmentationId: string, segmentId: string) =>
  store().getSegment(segmentId).representations.labelmap;

/** Creates a bound segment and hands back the ids and its binding. */
function makeBoundSegment(segmentationId: string, name?: string) {
  const segment = store().createSegment(
    segmentationId,
    name ? { name } : undefined
  );
  store().ensureLabelmapBinding(segment.id);
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
      expect(store().resolveLabelmapBinding(segment.id)).toBeFalsy();
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
      expect(store().getSegment(second.id).id).toBe(second.id);
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
      expect(store().getSegment(segment.id).name).toBe('Tumor');
    });

    it('keeps duplicate and blank names', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = store().createSegment(segmentationId, { name: 'Tumor' });
      const second = store().createSegment(segmentationId, { name: 'Tumor' });
      const blank = store().createSegment(segmentationId, { name: '' });
      store().updateSegment(first.id, { name: '' });

      expect(second.id).not.toBe(first.id);
      expect(store().getSegment(second.id).name).toBe('Tumor');
      expect(store().getSegment(blank.id).name).toBe('');
      expect(store().getSegment(first.id).name).toBe('');
      expect(store().segmentations[segmentationId].order).toEqual([
        first.id,
        second.id,
        blank.id,
      ]);
    });
  });

  describe('ensureLabelmapBinding', () => {
    it('allocates one mask on the parent image for the segment', async () => {
      await seatImage('img-1', 'Chest CT');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect(Object.keys(store().artifactIndex)).toEqual([binding.artifactId]);
      expect(store().artifactMeta[binding.artifactId].parentImage).toBe(
        'img-1'
      );
      expect(
        store().artifactMeta[binding.artifactId].name.length
      ).toBeGreaterThan(0);
    });

    it('covers nothing until an edit says what to cover', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const { binding } = makeBoundSegment(segmentationId);

      expect(isEmptyExtent(binding.extent)).toBe(true);
      expect([
        ...store().artifactIndex[binding.artifactId].getDimensions(),
      ]).toEqual([0, 0, 0]);
      expect(artifactScalars(binding.artifactId)).toHaveLength(0);
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

      const first = store().ensureLabelmapBinding(segment.id);
      const second = store().ensureLabelmapBinding(segment.id);

      expect(second.artifactId).toBe(first.artifactId);
      expect(second.labelValue).toBe(first.labelValue);
      expect(Object.keys(store().artifactIndex)).toHaveLength(1);
    });

    it('gives two segments of one segmentation their own mask and distinct values', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');

      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      expect(second.binding.artifactId).not.toBe(first.binding.artifactId);
      expect(second.binding.labelValue).not.toBe(first.binding.labelValue);
      expect(Object.keys(store().artifactIndex)).toHaveLength(2);
    });

    it('resolves a binding to the artifact labelmap and its label value', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const { id: segmentId, binding } = makeBoundSegment(segmentationId);

      const resolved = store().resolveLabelmapBinding(segmentId);

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

      store().updateSegment(first.id, {
        name: 'Primary tumor',
        color: [7, 8, 9, 255],
        visible: false,
        locked: true,
      });
      store().reorderSegments(segmentationId, [second.id, first.id]);

      const renamed = store().getSegment(first.id);
      expect(renamed.id).toBe(first.id);
      expect(renamed.name).toBe('Primary tumor');
      expect([...renamed.color]).toEqual([7, 8, 9, 255]);
      expect(renamed.visible).toBe(false);
      expect(renamed.locked).toBe(true);
      expect(renamed.representations.labelmap).toEqual(first.binding);
      expect(store().getSegment(second.id).id).toBe(second.id);
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

      store().updateSegment(first.id, { name: 'Renamed' });

      expect(store().getSegment(second.id).name).toBe('Node');
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
      expect(store().getSegment(first.id).id).toBe(first.id);
      expect(store().getSegment(second.id).id).toBe(second.id);
      expect(store().resolveLabelmapBinding(first.id)!.labelmap).not.toBe(
        store().resolveLabelmapBinding(second.id)!.labelmap
      );
    });
  });

  describe('deleteSegment', () => {
    it('leaves the neighbour mask alone', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const doomed = makeBoundSegment(segmentationId, 'Tumor');
      const kept = makeBoundSegment(segmentationId, 'Node');
      store().segmentVoxels(kept.id).ensureContains([0, 0, 0, 0, 0, 0]);
      store().segmentVoxels(kept.id).scalars()[0] = kept.binding.labelValue;

      store().deleteSegment(doomed.id);

      expect([...store().segmentVoxels(kept.id).scalars()]).toEqual([
        kept.binding.labelValue,
      ]);
      expect(store().segmentations[segmentationId].order).toEqual([kept.id]);
      expect(
        Object.keys(store().segmentations[segmentationId].segments)
      ).toEqual([kept.id]);
    });

    it('releases the segment mask with the segment', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const first = makeBoundSegment(segmentationId, 'Tumor');
      const second = makeBoundSegment(segmentationId, 'Node');

      store().deleteSegment(first.id);

      expect(Object.keys(store().artifactIndex)).toEqual([
        second.binding.artifactId,
      ]);
      expect(Object.keys(store().artifactMeta)).toEqual([
        second.binding.artifactId,
      ]);

      store().deleteSegment(second.id);

      expect(Object.keys(store().artifactIndex)).toEqual([]);
      expect(Object.keys(store().artifactMeta)).toEqual([]);
      expect(store().segmentations[segmentationId].order).toEqual([]);
    });

    it('deletes an unbound segment without allocating storage', async () => {
      await seatImage('img-1');
      const { id: segmentationId } =
        store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentationId);

      store().deleteSegment(segment.id);

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
      expect(store().getSegment(keptSegment.id).id).toBe(keptSegment.id);
    });
  });

  describe('conversion and decode', () => {
    it('creates one bound segment per discovered label value', async () => {
      await seatImage('parent-img', 'Chest CT');
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      values.fill(2, 12);
      await seatLabelValues('child-img', values);

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const segmentation = store().getSegmentationForImage('parent-img');
      expect(segmentation).toBeTruthy();
      expect(segmentation!.parentImageId).toBe('parent-img');
      const segments = segmentsOfImage('parent-img');
      expect(segments.map((segment) => segment.name)).toEqual([
        'Segment 1',
        'Segment 2',
      ]);
      expect(labelValuesOf(segments)).toEqual([1, 2]);
      segments.forEach((segment) => {
        expect(segment.visible).toBe(true);
        expect(segment.locked).toBe(false);
        expect(segment.id.length).toBeGreaterThan(0);
      });
    });

    it('binds each converted segment to a mask holding its own voxels', async () => {
      await seatImage('parent-img', 'Chest CT');
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      values.fill(2, 12);
      await seatLabelValues('child-img', values);

      await store().convertImageToLabelmap('child-img', 'parent-img');

      const segments = segmentsOfImage('parent-img');
      expect(segments).toHaveLength(2);
      const [first, second] = segments.map(
        (segment) => segment.representations.labelmap!.artifactId
      );
      expect(second).not.toBe(first);
      expect(store().resolveLabelmapBinding(segments[0].id)?.labelmap).toBe(
        store().artifactIndex[first]
      );
      // Each mask holds exactly one nonzero value, its segment's.
      expect(new Set(artifactScalars(first))).toEqual(new Set([1]));
      expect(new Set(artifactScalars(second))).toEqual(new Set([0, 2]));
      expect(store().artifactMeta[first].parentImage).toBe('parent-img');
      expect(store().artifactMeta[first].name.length).toBeGreaterThan(0);
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

      const segments = segmentsOfImage('parent-img');
      expect(labelValuesOf(segments)).toEqual([1, 2]);
      const byLabelValue = (labelValue: number) =>
        segments.find(
          (segment) =>
            segment.representations.labelmap!.labelValue === labelValue
        )!;
      expect(byLabelValue(2).name).toBe('Tumor core');
      expect([...byLabelValue(2).color]).toEqual([255, 0, 0, 255]);
      // Merge, not replace: an undescribed value keeps its default.
      expect(byLabelValue(1).name).toBe('Segment 1');
    });

    it('gives a second conversion of the same parent its own segments', async () => {
      await seatImage('parent-img', 'Chest CT');
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      await seatLabelValues('child-a', values);
      await seatLabelValues('child-b', values);
      const segmentGroups = store();

      await segmentGroups.convertImageToLabelmap('child-a', 'parent-img');
      await segmentGroups.convertImageToLabelmap('child-b', 'parent-img');

      expect(Object.keys(store().segmentations)).toHaveLength(1);
      const segments = segmentsOfImage('parent-img');
      expect(segments).toHaveLength(2);
      // Label values stay unique among the segments of one image.
      expect(labelValuesOf(segments)).toEqual([1, 2]);
      expect(segments[1].id).not.toBe(segments[0].id);
    });

    it('reports which segment each source label value became', async () => {
      await seatImage('parent-img', 'Chest CT');
      const values = new Uint8Array(VOXEL_COUNT);
      values.fill(1, 4, 12);
      await seatLabelValues('child-a', values);
      await seatLabelValues('child-b', values);
      const segmentGroups = store();

      await segmentGroups.convertImageToLabelmap('child-a', 'parent-img');
      const [second] = await segmentGroups.convertImageToLabelmap(
        'child-b',
        'parent-img'
      );

      // Source value 1 is already taken on the parent, so the second import's
      // segment holds value 2: only the report says which segment it is.
      const segments = segmentsOfImage('parent-img');
      expect(second).toEqual([{ sourceValue: 1, segmentId: segments[1].id }]);
      expect(segments[1].representations.labelmap!.labelValue).toBe(2);
    });

    it('enumerates no segments for an all-background labelmap', async () => {
      await seatImage('parent-img', 'Chest CT');
      await seatLabelValues('child-img', new Uint8Array(VOXEL_COUNT));

      await store().convertImageToLabelmap('child-img', 'parent-img');

      expect(segmentsOfImage('parent-img')).toEqual([]);
      expect(Object.keys(store().artifactIndex)).toEqual([]);
    });
  });

  describe('active target and cross-image intent', () => {
    /** Seats two images, each with an empty segmentation. */
    async function seatTwoImages() {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      return {
        one: store().ensureSegmentationForImage('img-1').id,
        two: store().ensureSegmentationForImage('img-2').id,
      };
    }

    const segmentOf = (segmentId: string) => store().getSegment(segmentId);

    it('sets the active target to the chosen segment', async () => {
      const { one } = await seatTwoImages();
      const segment = store().createSegment(one, { name: 'Tumor' });

      store().setActiveSegment(segment.id);

      expect(store().activeSegmentId).toBe(segment.id);
    });

    it('creates nothing on another image when the active segment is set', async () => {
      const { one, two } = await seatTwoImages();
      const segment = store().createSegment(one, { name: 'Tumor' });

      store().setActiveSegment(segment.id);

      expect(store().segmentations[two].order).toEqual([]);
      expect(store().segmentations[two].segments).toEqual({});
      expect(store().segmentations[one].order).toEqual([segment.id]);
      expect(Object.keys(store().artifactIndex)).toEqual([]);
    });

    it('creates no segmentation for an image that has none', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');
      const one = store().ensureSegmentationForImage('img-1').id;
      const segment = store().createSegment(one, { name: 'Tumor' });

      store().setActiveSegment(segment.id);

      expect(store().getSegmentationForImage('img-2')).toBeFalsy();
      expect(Object.keys(store().segmentations)).toEqual([one]);
    });

    it('resolves the image the active segment was set on to that segment', async () => {
      const { one } = await seatTwoImages();
      const segment = store().createSegment(one, { name: 'Tumor' });
      store().setActiveSegment(segment.id);

      const target = store().resolveEditTarget('img-1');

      expect(target).toBe(segment.id);
      expect(store().segmentations[one].order).toEqual([segment.id]);
    });

    it('clones the active name and color into a fresh segment on another image', async () => {
      const { one, two } = await seatTwoImages();
      const source = store().createSegment(one, {
        name: 'Tumor',
        color: [12, 34, 56, 255],
      });
      store().setActiveSegment(source.id);

      const target = store().resolveEditTarget('img-2');

      expect(target).not.toBe(source.id);
      const clone = segmentOf(target);
      expect(clone.name).toBe('Tumor');
      expect([...clone.color]).toEqual([12, 34, 56, 255]);
      expect(clone.visible).toBe(true);
      expect(clone.locked).toBe(false);
      expect(store().segmentations[two].order).toEqual([target]);
      expect(store().activeSegmentId).toBe(target);
    });

    it('reuses the cloned target for the rest of the session', async () => {
      const { one, two } = await seatTwoImages();
      const source = store().createSegment(one, { name: 'Tumor' });
      store().setActiveSegment(source.id);

      const first = store().resolveEditTarget('img-2');
      const back = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(back).toBe(source.id);
      expect(second).toBe(first);
      expect(store().segmentations[two].order).toEqual([first]);
      expect(store().segmentations[one].order).toEqual([source.id]);
    });

    it('keeps the landing map when the segment it already landed on is reselected', async () => {
      const { one } = await seatTwoImages();
      const source = store().createSegment(one, { name: 'Tumor' });
      store().setActiveSegment(source.id);
      const clone = store().resolveEditTarget('img-2');

      store().setActiveSegment(clone);

      expect(store().resolveEditTarget('img-1')).toBe(source.id);
      expect(store().segmentations[one].order).toEqual([source.id]);
    });

    it('keeps a clone independent of the segment it came from', async () => {
      const { one } = await seatTwoImages();
      const source = store().createSegment(one, {
        name: 'Tumor',
        color: [12, 34, 56, 255],
      });
      store().setActiveSegment(source.id);
      const target = store().resolveEditTarget('img-2');

      store().updateSegment(source.id, {
        name: 'Lesion',
        color: [9, 9, 9, 255],
      });

      expect(segmentOf(target).name).toBe('Tumor');
      expect([...segmentOf(target).color]).toEqual([12, 34, 56, 255]);

      store().updateSegment(target, {
        name: 'Metastasis',
      });

      expect(store().getSegment(source.id).name).toBe('Lesion');
    });

    it('never merges with an existing segment of the same name', async () => {
      const { one, two } = await seatTwoImages();
      const existing = store().createSegment(two, { name: 'Tumor' });
      const source = store().createSegment(one, { name: 'Tumor' });
      store().setActiveSegment(source.id);

      const target = store().resolveEditTarget('img-2');

      expect(target).not.toBe(existing.id);
      expect(store().segmentations[two].order).toEqual([existing.id, target]);
      expect(store().getSegment(existing.id).name).toBe('Tumor');
      expect(segmentOf(target).name).toBe('Tumor');
    });

    it('clones again when the recorded target has been deleted', async () => {
      const { one, two } = await seatTwoImages();
      const source = store().createSegment(one, { name: 'Tumor' });
      store().setActiveSegment(source.id);
      const first = store().resolveEditTarget('img-2');

      store().deleteSegment(first);
      const second = store().resolveEditTarget('img-2');

      expect(store().segmentations[two].segments[second]).toBeDefined();
      expect(second).not.toBe(first);
      expect(segmentOf(second).name).toBe('Tumor');
      expect(store().segmentations[two].order).toEqual([second]);
    });

    it('starts a fresh intent on every setActiveSegment', async () => {
      const { one, two } = await seatTwoImages();
      const first = store().createSegment(one, { name: 'Tumor' });
      const second = store().createSegment(one, { name: 'Node' });
      store().setActiveSegment(first.id);
      const fromFirst = store().resolveEditTarget('img-2');

      store().setActiveSegment(second.id);
      const fromSecond = store().resolveEditTarget('img-2');

      expect(fromSecond).not.toBe(fromFirst);
      expect(segmentOf(fromSecond).name).toBe('Node');
      expect(segmentOf(fromFirst).name).toBe('Tumor');
      expect(store().segmentations[two].order).toEqual([fromFirst, fromSecond]);
    });

    it('seeds a segmentation and a default segment on the first edit of a session', async () => {
      await seatImage('img-1');

      const target = store().resolveEditTarget('img-1');

      const segmentation = store().getSegmentationForImage('img-1');
      expect(segmentation!.order).toEqual([target]);
      const segment = segmentOf(target);
      expect(segment.name).toBe(DEFAULT_SEGMENT_MASKS[0].name);
      expect([...segment.color]).toEqual([...DEFAULT_SEGMENT_MASKS[0].color]);
      expect(segment.visible).toBe(true);
      expect(segment.locked).toBe(false);
      expect(store().activeSegmentId).toBe(target);
    });

    it('binds the seeded default segment to storage for its own image', async () => {
      await seatImage('img-1');

      const target = store().resolveEditTarget('img-1');
      const binding = store().ensureLabelmapBinding(target);

      expect(store().artifactMeta[binding.artifactId].parentImage).toBe(
        'img-1'
      );
      expect(binding.labelValue).toBeGreaterThan(0);
      const resolved = store().resolveLabelmapBinding(target);
      expect(resolved!.labelmap).toBe(
        store().artifactIndex[binding.artifactId]
      );
    });

    it('gives each image its own segment when no intent was ever set', async () => {
      await seatImage('img-1');
      await seatImage('img-2', 'PET');

      const first = store().resolveEditTarget('img-1');
      const second = store().resolveEditTarget('img-2');

      expect(second).not.toBe(first);
      expect(store().getSegmentationForImage('img-2')!.order).toEqual([second]);
    });
  });
});
