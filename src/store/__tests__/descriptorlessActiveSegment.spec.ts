import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { listSegments } from '@/src/types/segmentation';

// ---------------------------------------------------------------------------
// A pre-7 group with no descriptors has no segments to activate when
// `activeSegment` is applied, so the migration parks the legacy paint value on
// the artifact as `pendingActiveValue` and the split stage reactivates it. That
// value is a SOURCE artifact value. Label values are now unique across the
// parent image, so a second group carrying the same source values is remapped
// as it splits, and the pending value no longer names any binding.
// ---------------------------------------------------------------------------

const BASE_URI = 'volview-backend:base/ct-chest-001';

function makeImage(values: Uint8Array) {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  image
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  image.computeTransforms();
  return image;
}

/** Background plus two segments, at voxel values 1 and 2. */
function makeLabelmapValues() {
  const values = new Uint8Array(4 * 4 * 4);
  values.fill(1, 20, 44);
  values.fill(2, 44);
  return values;
}

const seat = (id: string, name: string, values: Uint8Array) =>
  useImageCacheStore().addVTKImageData(makeImage(values), name, { id });

/** Two descriptorless groups on one parent, the second one active. */
const twoGroupManifest = (activeValue: number): Manifest =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({
        version: '6.4.0',
        dataSources: [
          { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
          { id: 3, type: 'uri', uri: `${BASE_URI}/a`, name: 'A.seg.nrrd' },
          { id: 4, type: 'uri', uri: `${BASE_URI}/b`, name: 'B.seg.nrrd' },
        ],
        datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
        segmentGroups: [
          {
            id: 'sg-a',
            dataSourceId: 3,
            metadata: { name: 'A', parentImage: 'ds-ct' },
          },
          {
            id: 'sg-b',
            dataSourceId: 4,
            metadata: { name: 'B', parentImage: 'ds-ct' },
          },
        ],
        tools: {
          paint: { activeSegmentGroupID: 'sg-b', activeSegment: activeValue },
        },
      })
    )
  );

async function restoreTwoGroups(activeValue: number) {
  setActivePinia(createPinia());
  seat('parent-store', 'CT Chest', new Uint8Array(4 * 4 * 4));
  seat('a-store', 'A.seg.nrrd', makeLabelmapValues());
  seat('b-store', 'B.seg.nrrd', makeLabelmapValues());

  await completeStateFileRestore(twoGroupManifest(activeValue), [], {
    'ds-ct': 'parent-store',
    [leafStateId(3)]: 'a-store',
    [leafStateId(4)]: 'b-store',
  });
}

const catalog = () => {
  const store = useSegmentationStore();
  const segmentation = store.getSegmentationForImage('parent-store')!;
  return listSegments(segmentation);
};

const labelValues = () =>
  catalog().map((segment) => segment.representations.labelmap!.labelValue);

const activeLabelValue = () => {
  const store = useSegmentationStore();
  return catalog().find((segment) => segment.id === store.activeSegmentId)
    ?.representations.labelmap?.labelValue;
};

describe('restoring a descriptorless active group', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('remaps the second group off the label values the first took', async () => {
    await restoreTwoGroups(1);

    expect(labelValues()).toEqual([1, 2, 3, 4]);
  });

  it('activates the segment split from the pending SOURCE value', async () => {
    await restoreTwoGroups(1);

    // Source value 1 of the second group, which had to become 3.
    expect(activeLabelValue()).toBe(3);
  });

  it('activates the right segment when the pending value is the later one', async () => {
    await restoreTwoGroups(2);

    expect(activeLabelValue()).toBe(4);
  });

  it('leaves the active segment alone when no source value matches', async () => {
    await restoreTwoGroups(7);

    expect(useSegmentationStore().activeSegmentId).toBeUndefined();
  });
});
