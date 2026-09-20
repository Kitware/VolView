import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  maskOn,
  lockSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

import {
  rasterizeTargetDisabledReason,
  resolveRasterizeTarget,
} from '@/src/segmentation/editing/rasterizePolygon';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

const store = () => useSegmentationStore();
const segments = () => useSegmentStore().segments;

const makeMask = (imageId: string, name: string) => {
  const segmentId = segments().mintSegment({ name });
  return { segmentId, record: maskOn(imageId, segmentId) };
};

const targetOf = (imageId: string, segmentId: string | undefined) =>
  resolveRasterizeTarget(imageId, segmentId)!;

describe('polygon rasterize target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('allocates storage for a record that has none', async () => {
    await seatImage('img-1');
    const segment = makeMask('img-1', 'Tumor');

    const target = targetOf('img-1', segment.segmentId);

    expect(target.labelValue).toBe(SEGMENT_VALUE);
    expect(
      store()
        .maskLayersForImage('img-1')
        .map((layer) => layer.maskId)
    ).toEqual([target.maskId]);
    expect(target.voxels.image()).toBe(
      store().findMaskBinding(target.maskId)!.image
    );
    expect(
      store().getMask(segment.record.id).representations.labelmap!.image
    ).toBe(target.voxels.image());
  });

  it('resolves the given type rather than the first one', async () => {
    await seatImage('img-1');
    const first = makeMask('img-1', 'Other');
    store().maskVoxels(first.record.id).materialize();
    const second = makeMask('img-1', 'Tumor');

    const target = targetOf('img-1', second.segmentId);

    expect(target.voxels.image()).not.toBe(
      store().findMaskBinding(first.record.id)!.image
    );
  });

  it('reuses the same binding on a second rasterize', async () => {
    await seatImage('img-1');
    const segment = makeMask('img-1', 'Tumor');

    const first = targetOf('img-1', segment.segmentId);
    const second = targetOf('img-1', segment.segmentId);

    expect(second.voxels.image()).toBe(first.voxels.image());
    expect(store().maskLayersForImage('img-1')).toHaveLength(1);
  });

  it('leaves the selected type alone', async () => {
    await seatImage('img-1');
    const active = makeMask('img-1', 'Active');
    const other = makeMask('img-1', 'Other');
    segments().selectSegment(active.segmentId);

    targetOf('img-1', other.segmentId);

    expect(segments().selectedSegmentId.value).toBe(active.segmentId);
  });

  it('takes this image record for a type painted on another image', async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const elsewhere = makeMask('img-2', 'Tumor');

    const target = targetOf('img-1', elsewhere.segmentId);

    expect(target.maskId).not.toBe(elsewhere.record.id);
    expect(store().getMask(target.maskId).segmentId).toBe(elsewhere.segmentId);
  });

  it('refuses a locked record before allocating storage for it', async () => {
    await seatImage('img-1');
    const segment = makeMask('img-1', 'Tumor');
    lockSegment(segment.record.id, true);

    expect(resolveRasterizeTarget('img-1', segment.segmentId)).toBeUndefined();

    expect(
      store().getMask(segment.record.id).representations.labelmap
    ).toBeUndefined();
    expect(store().maskLayersForImage('img-1')).toEqual([]);
    expect(
      useMessageStore().messages.map((message) => message.title)
    ).toContain('Cannot rasterize into a locked segment');
    expect(rasterizeTargetDisabledReason(segment.segmentId)).toBe(
      'Unlock this segment to rasterize into it'
    );
  });

  it('describes the same selected fallback execution will use', async () => {
    await seatImage('img-1');
    const stale = makeMask('img-1', 'Deleted');
    const fallback = makeMask('img-1', 'Selected');
    segments().selectSegment(fallback.segmentId);
    segments().deleteSegment(stale.segmentId);
    lockSegment(fallback.record.id, true);

    expect(rasterizeTargetDisabledReason(stale.segmentId)).toBe(
      'Unlock this segment to rasterize into it'
    );
    expect(rasterizeTargetDisabledReason('')).toBe(
      'Unlock this segment to rasterize into it'
    );

    lockSegment(fallback.record.id, false);
    expect(rasterizeTargetDisabledReason(stale.segmentId)).toBe('');
    expect(targetOf('img-1', stale.segmentId).segmentId).toBe(
      fallback.segmentId
    );
  });

  it('describes the first-segment fallback without selecting or allocating it', async () => {
    await seatImage('img-1');
    const first = makeMask('img-1', 'First');
    lockSegment(first.record.id, true);

    expect(segments().selectedSegmentId.value).toBeUndefined();
    expect(rasterizeTargetDisabledReason('')).toBe(
      'Unlock this segment to rasterize into it'
    );
    expect(segments().selectedSegmentId.value).toBeUndefined();
    expect(
      store().getMask(first.record.id).representations.labelmap
    ).toBeUndefined();
  });

  it('rasterizes into a minted type when nothing is selected', async () => {
    await seatImage('img-1');

    const target = targetOf('img-1', undefined);

    const segmentation = store().getSegmentationForImage('img-1');
    expect(Object.keys(segmentation!.masks)).toHaveLength(1);
    expect(segments().selectedSegmentId.value).toBe(target.segmentId);
    expect(target.voxels.image()).toBe(
      store().findMaskBinding(target.maskId)!.image
    );
    expect(target.maskId).toBe(Object.keys(segmentation!.masks)[0]);
  });

  it('reuses the default segment on a second rasterize', async () => {
    await seatImage('img-1');

    const first = targetOf('img-1', undefined);
    const second = targetOf('img-1', undefined);

    expect(second.voxels.image()).toBe(first.voxels.image());
    expect(second.labelValue).toBe(first.labelValue);
    expect(
      Object.keys(store().getSegmentationForImage('img-1')!.masks)
    ).toHaveLength(1);
  });

  it('hands back the accessor the polygon writes through', async () => {
    await seatImage('img-1');
    const segment = makeMask('img-1', 'Tumor');

    const target = targetOf('img-1', segment.segmentId);
    target.voxels.ensureContains([0, 3, 0, 0, 0, 0]);
    // fillPoly writes voxel offsets into the live buffer, so a copy would be
    // rasterized and thrown away.
    target.voxels.scalars()[3] = target.labelValue;

    expect(
      store()
        .findMaskBinding(target.maskId)!
        .image.getPointData()
        .getScalars()
        .getData()[3]
    ).toBe(target.labelValue);
  });

  it('rasterizes into a minted type when the tool names a deleted one', async () => {
    await seatImage('img-1');
    const segment = makeMask('img-1', 'Tumor');
    segments().deleteSegment(segment.segmentId);

    // The tool keeps the deleted type's id; that must not block rasterizing.
    const target = targetOf('img-1', segment.segmentId);

    expect(target.segmentId).not.toBe(segment.segmentId);
    expect(store().getSegmentationForImage('img-1')!.masks).toHaveProperty(
      target.maskId
    );
  });
});
