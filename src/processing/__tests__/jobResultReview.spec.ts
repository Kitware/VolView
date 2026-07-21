import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkLabelMap from '@/src/vtk/LabelMap';

import { useJobResultReviewStore } from '@/src/processing/jobResultReview';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';

// The live-only "new job result" badge set. Born-persistent review
// model — the badge is the ONLY review surface; the group
// itself is a normal deletable object. The set is never serialized.

describe('jobResultReview store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('marks a group as a new result and reads it back', () => {
    const store = useJobResultReviewStore();
    expect(store.isNew('g1')).toBe(false);
    store.markNew('g1');
    expect(store.isNew('g1')).toBe(true);
  });

  it('dismiss drops the badge without touching any group', () => {
    const store = useJobResultReviewStore();
    store.markNew('g1');
    store.dismiss('g1');
    expect(store.isNew('g1')).toBe(false);
    // Dismissing an unmarked id is a harmless no-op.
    expect(() => store.dismiss('never-marked')).not.toThrow();
  });

  it('clear removes every badge', () => {
    const store = useJobResultReviewStore();
    store.markNew('g1');
    store.markNew('g2');
    store.clear();
    expect(store.isNew('g1')).toBe(false);
    expect(store.isNew('g2')).toBe(false);
    expect(store.newResultGroupIds.size).toBe(0);
  });
});

// The "reject" acceptance: a job result is a NORMAL group
// removed by the EXISTING delete primitive (`removeGroup`, what the delete button
// calls) — no bespoke reject widget, no dismissed-list, no server flag. Deleting
// it also drops the live-only badge (what SegmentGroupControls.deleteGroup does).
describe('deleting an auto-shown job result (existing delete UI)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const makeJobLabelmap = () => {
    const labelmap = vtkLabelMap.newInstance();
    labelmap.setDimensions([2, 2, 2]);
    labelmap.getPointData().setScalars(
      vtkDataArray.newInstance({
        numberOfComponents: 1,
        values: new Uint8Array(8),
      })
    );
    labelmap.computeTransforms();
    return labelmap;
  };

  it('cases 8/11: a born-persistent job result is a normal group the delete UI removes', () => {
    const segmentGroupStore = useSegmentGroupStore();
    const review = useJobResultReviewStore();

    // A born-persistent job result: a NORMAL group carrying the source tag.
    const id = segmentGroupStore.addLabelmap(makeJobLabelmap(), {
      name: 'Otsu result',
      parentImage: 'parent-1',
      segments: { order: [], byValue: {} },
      source: { jobId: 'job-1', outputId: 'out-1' },
    });
    review.markNew(id);

    expect(segmentGroupStore.metadataByID[id]?.source).toEqual({
      jobId: 'job-1',
      outputId: 'out-1',
    });
    expect(segmentGroupStore.orderByParent['parent-1']).toContain(id);
    expect(review.isNew(id)).toBe(true);

    // Reject = the existing delete primitive alone. The review store subscribes
    // to the segment-group store's `removeGroup` action ($onAction), so removal
    // through ANY path clears the badge — no core→feature import, no explicit
    // dismiss call at the delete site.
    segmentGroupStore.removeGroup(id);

    expect(segmentGroupStore.metadataByID[id]).toBeUndefined();
    expect(segmentGroupStore.orderByParent['parent-1']).not.toContain(id);
    expect(review.isNew(id)).toBe(false);
  });
});
