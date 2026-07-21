import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { useCropStore } from '@/src/store/tools/crop';
import { usePaintToolStore } from '@/src/store/tools/paint';

// Bind an existing (default-layout) view to a dataset via the public API —
// `addView` is internal, but every fresh store already seats slot views.
const bindFirstViewTo = (dataID: string) => {
  const viewStore = useViewStore();
  const [viewID] = viewStore.viewIDs;
  viewStore.setDataForView(viewID, dataID);
  return viewID;
};

// ---------------------------------------------------------------------------
// Delete-a-dataset-then-save, the whole cascade.
//
// Removing a dataset must clean EVERY store that references it SYNCHRONOUSLY —
// before `remove()` returns — so a `serialize()` on the same tick (what
// applying a job "Open" result does) can never snapshot a dangling reference.
//
// Note the absence of `await nextTick()` in these tests: the whole cascade is
// synchronous, so a same-tick serialize never sees orphaned ids. This
// exercises the real `datasetStore.remove` entrypoint.
// ---------------------------------------------------------------------------

const seatImage = (id: string, name: string) => {
  const img = vtkImageData.newInstance();
  img.setDimensions(2, 2, 2);
  const scalars = vtkDataArray.newInstance({
    name: 'scalars',
    numberOfComponents: 1,
    values: new Uint8Array(8),
  });
  img.getPointData().setScalars(scalars);
  return useImageCacheStore().addVTKImageData(img, name, { id });
};

const makeRuler = (imageID: string) =>
  ({
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
    imageID,
    name: 'Ruler',
    frameOfReference: {
      planeNormal: [1, 0, 0],
      planeOrigin: [0, 0, 0],
    },
    slice: 23,
    placing: false,
  }) as never;

describe('dataset remove — synchronous reference cascade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('clears segment groups whose parent image was removed', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const groupId = segmentGroups.newLabelmapFromImage('img-1');
    expect(groupId).not.toBeNull();
    expect(segmentGroups.orderByParent['img-1']).toContain(groupId);

    useDatasetStore().remove('img-1');

    expect(segmentGroups.orderByParent['img-1'] ?? []).toEqual([]);
    expect(segmentGroups.metadataByID).not.toHaveProperty(groupId as string);
  });

  it('clears ALL segment groups when an image has several (no splice-skip)', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const groupA = segmentGroups.newLabelmapFromImage('img-1');
    const groupB = segmentGroups.newLabelmapFromImage('img-1');
    const groupC = segmentGroups.newLabelmapFromImage('img-1');
    expect(groupA).not.toBeNull();
    expect(groupB).not.toBeNull();
    expect(groupC).not.toBeNull();
    expect(segmentGroups.orderByParent['img-1']).toEqual([
      groupA,
      groupB,
      groupC,
    ]);

    useDatasetStore().remove('img-1');

    expect(segmentGroups.orderByParent['img-1'] ?? []).toEqual([]);
    [groupA, groupB, groupC].forEach((id) => {
      expect(segmentGroups.metadataByID).not.toHaveProperty(id as string);
      expect(segmentGroups.dataIndex).not.toHaveProperty(id as string);
    });
  });

  it('clears annotation tools bound to the removed image', () => {
    seatImage('img-1', 'CT');
    const rulerStore = useRulerStore();
    rulerStore.addRuler(makeRuler('img-1'));

    useDatasetStore().remove('img-1');

    expect(rulerStore.serializeTools().tools).toEqual([]);
  });

  it('unbinds views pointing at the removed dataset', () => {
    seatImage('img-1', 'CT');
    const viewStore = useViewStore();
    bindFirstViewTo('img-1');
    expect(viewStore.getViewsForData('img-1')).toHaveLength(1);

    useDatasetStore().remove('img-1');

    expect(viewStore.getViewsForData('img-1')).toEqual([]);
  });

  it('drops crop state keyed by the removed image', () => {
    seatImage('img-1', 'CT');
    const cropStore = useCropStore();
    cropStore.setCropping('img-1', {
      Sagittal: [0, 1],
      Coronal: [0, 1],
      Axial: [0, 1],
    });
    expect('img-1' in cropStore.croppingByImageID).toBe(true);

    useDatasetStore().remove('img-1');

    expect('img-1' in cropStore.croppingByImageID).toBe(false);
  });

  it('nulls the active paint segment group when its parent image is removed', () => {
    seatImage('img-1', 'CT');
    const segmentGroups = useSegmentGroupStore();
    const paintStore = usePaintToolStore();
    const groupId = segmentGroups.newLabelmapFromImage('img-1');
    paintStore.setActiveSegmentGroup(groupId);
    expect(paintStore.activeSegmentGroupID).toBe(groupId);

    useDatasetStore().remove('img-1');

    expect(paintStore.activeSegmentGroupID).toBeNull();
  });

  it('leaves references to OTHER datasets intact', () => {
    seatImage('img-1', 'CT');
    seatImage('img-2', 'PET');
    const rulerStore = useRulerStore();
    const viewStore = useViewStore();
    rulerStore.addRuler(makeRuler('img-2'));
    bindFirstViewTo('img-2');

    useDatasetStore().remove('img-1');

    expect(rulerStore.serializeTools().tools).toHaveLength(1);
    expect(viewStore.getViewsForData('img-2')).toHaveLength(1);
  });
});
