import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  addMask,
  deleteSegmentOf,
  mintSegment,
  seatImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const maskIdFor = (segmentId: string) =>
  store().maskFor('img-1', segmentId)?.id;

const bindingNames = () =>
  Object.values(store().segmentations).flatMap((segmentation) =>
    segmentation.order.flatMap((maskId) => {
      const binding = segmentation.masks[maskId].representations.labelmap;
      return binding ? [binding.name] : [];
    })
  );

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

    deleteSegmentOf(masks[1]);

    expect(maskIdFor(first)).toBe(masks[0]);
    expect(maskIdFor(second)).toBeUndefined();
    expect(maskIdFor(third)).toBe(masks[2]);
  });

  it('reaches a computed when a mask appears and when it goes', () => {
    const segmentId = mintSegment();
    const seen = computed(() => maskIdFor(segmentId));

    expect(seen.value).toBeUndefined();
    const segmentation = store().ensureSegmentationForImage('img-1');
    const maskId = store().createMask(segmentation.id, segmentId).id;
    expect(seen.value).toBe(maskId);

    deleteSegmentOf(maskId);
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

    deleteSegmentOf(first.id);
    store().ensureLabelmapBinding(addMask('img-1'));

    // The surviving mask still holds the name, so the next one skips past it.
    expect(bindingNames()).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
  });

  it('hands a removed mask name back to the next one', () => {
    const removed = splitCarrying('Segment Group 2 for CT A');
    deleteSegmentOf(removed.id);

    store().ensureLabelmapBinding(addMask('img-1'));
    store().ensureLabelmapBinding(addMask('img-1'));

    expect(bindingNames()).toEqual([
      'Segment Group 1 for CT A',
      'Segment Group 2 for CT A',
    ]);
  });
});
