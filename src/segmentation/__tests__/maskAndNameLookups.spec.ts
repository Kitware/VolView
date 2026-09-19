import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import vtkLabelMap from '@/src/vtk/LabelMap';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  addMask,
  mintSegment,
  seatImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const registry = () => useSegmentStore().segments;

const maskIdFor = (segmentId: string) =>
  store().maskFor('img-1', segmentId)?.id;

const bindingNames = () =>
  Object.values(store().segmentations).flatMap((segmentation) =>
    segmentation.order.flatMap((maskId) => {
      const binding = segmentation.masks[maskId].representations.labelmap;
      return binding ? [binding.name] : [];
    })
  );

/** A single labelled voxel, as a restored artifact arrives. */
const oneLabelledVoxel = () => {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions([4, 4, 4]);
  const values = new Uint8Array(4 * 4 * 4);
  values[0] = 1;
  labelmap
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  labelmap.computeTransforms();
  return labelmap;
};

/** Seats one mask whose binding carries the name a manifest stated. */
const splitCarrying = (name: string) =>
  store().splitLabelmapIntoMasks(
    'img-1',
    oneLabelledVoxel(),
    [{ value: 1, name: 'Liver', color: [255, 0, 0, 255], visible: true }],
    { name }
  )[0];

describe('the mask index a segment is looked up through', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT A' });
  });

  it('answers for the segments beside one that was detached', () => {
    const [first, second, third] = ['a', 'b', 'c'].map(() => mintSegment());
    const masks = [first, second, third].map((segmentId) => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      return store().createMask(segmentation.id, segmentId).id;
    });

    store().deleteMask(masks[1]);

    expect(maskIdFor(first)).toBe(masks[0]);
    expect(maskIdFor(second)).toBeUndefined();
    expect(maskIdFor(third)).toBe(masks[2]);
  });

  it('answers with the new mask after a detach and a re-attach', () => {
    const segmentId = mintSegment();
    const segmentation = store().ensureSegmentationForImage('img-1');
    const first = store().createMask(segmentation.id, segmentId).id;

    store().deleteMask(first);
    const second = store().createMask(segmentation.id, segmentId).id;

    expect(second).not.toBe(first);
    expect(maskIdFor(segmentId)).toBe(second);
    // One mask per (image, segment) still holds after the round trip.
    expect(() => store().createMask(segmentation.id, segmentId)).toThrow();
  });

  it('reaches a computed when a mask appears and when it goes', () => {
    const segmentId = mintSegment();
    const seen = computed(() => maskIdFor(segmentId));

    expect(seen.value).toBeUndefined();
    const segmentation = store().ensureSegmentationForImage('img-1');
    const maskId = store().createMask(segmentation.id, segmentId).id;
    expect(seen.value).toBe(maskId);

    store().deleteMask(maskId);
    expect(seen.value).toBeUndefined();
  });
});

describe('the names bound masks hold', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT A' });
  });

  it('skips a name a restored mask already carries', () => {
    splitCarrying('Segment Group 2 for CT A');
    store().ensureLabelmapBinding(addMask('img-1'));
    store().ensureLabelmapBinding(addMask('img-1'));

    expect(bindingNames()).toEqual([
      'Segment Group 2 for CT A',
      'Segment Group 1 for CT A',
      'Segment Group 3 for CT A',
    ]);
  });

  it('frees a shared name only when its last holder goes', () => {
    // A restore attaches the names the file states, so two masks can carry
    // one name however the namer would have picked them.
    const first = splitCarrying('Segment Group 1 for CT A');
    splitCarrying('Segment Group 1 for CT A');

    store().deleteMask(first.id);
    store().ensureLabelmapBinding(addMask('img-1'));

    // The surviving mask still holds the name, so the next one skips past it.
    expect(bindingNames()).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
  });

  it('hands a removed mask name back to the next one', () => {
    const removed = splitCarrying('Segment Group 2 for CT A');
    store().deleteMask(removed.id);

    store().ensureLabelmapBinding(addMask('img-1'));
    store().ensureLabelmapBinding(addMask('img-1'));

    expect(bindingNames()).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
  });
});

describe('the name index the registry answers from', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('frees a deleted segment name for the next one', () => {
    const id = registry().mintSegment({ name: 'Liver' });
    expect(registry().uniqueName('Liver')).toBe('Liver (2)');

    registry().deleteSegment(id);

    expect(registry().uniqueName('Liver')).toBe('Liver');
    expect(registry().findSegmentByName('Liver')).toBeUndefined();
  });

  it('follows a rename, freeing the old name and finding the new one', () => {
    const id = registry().mintSegment({ name: 'Liver' });

    registry().updateSegment(id, { name: 'Spleen' });

    expect(registry().findSegmentByName('Liver')).toBeUndefined();
    expect(registry().findSegmentByName('Spleen')?.id).toBe(id);
    expect(registry().uniqueName('Liver')).toBe('Liver');
    expect(registry().uniqueName('Spleen')).toBe('Spleen (2)');
  });

  it('answers in the same space the index keys on', () => {
    registry().mintSegment({ name: 'Liver' });

    // The index ignores surrounding space, so a padded stem is the same name:
    // answering it unchanged would seat a row nothing could tell apart.
    expect(registry().uniqueName(' Liver ')).toBe('Liver (2)');
    expect(registry().uniqueName(' Spleen ')).toBe('Spleen');
  });

  it('takes the first in registry order when a name repeats', () => {
    const first = registry().mintSegment({ name: 'Liver' });
    const second = registry().mintSegment({ name: 'Other' });
    registry().updateSegment(second, { name: 'Liver' });

    expect(registry().findSegmentByName('Liver')?.id).toBe(first);

    registry().moveSegment(second, first);

    expect(registry().findSegmentByName('Liver')?.id).toBe(second);
  });

  it('names a default segment after the lowest free index', () => {
    const first = registry().mintSegment();
    const second = registry().mintSegment();
    expect(
      [first, second].map((id) => registry().getSegment(id)?.name)
    ).toEqual(['Segment 1', 'Segment 2']);

    registry().deleteSegment(first);

    expect(registry().getSegment(registry().mintSegment())?.name).toBe(
      'Segment 1'
    );
  });
});

describe('registry order across mints and removals', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps insertion order and the order index in step', () => {
    const names = () => registry().segmentList.value.map((type) => type.name);
    const listed = computed(names);

    const ids = ['A', 'B', 'C'].map((name) => registry().mintSegment({ name }));
    expect(listed.value).toEqual(['A', 'B', 'C']);

    registry().deleteSegment(ids[1]);
    const fourth = registry().mintSegment({ name: 'D' });

    expect(listed.value).toEqual(['A', 'C', 'D']);
    expect(registry().orderIndexOf(fourth)).toBe(2);
    expect(registry().orderIndexOf(ids[1])).toBe(-1);

    registry().updateSegment(ids[2], { name: 'C2' });
    expect(listed.value).toEqual(['A', 'C2', 'D']);
  });
});
