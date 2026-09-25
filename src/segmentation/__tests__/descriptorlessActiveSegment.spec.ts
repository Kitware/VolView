import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { listMasks } from '@/src/segmentation/model';

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

function makeLabelmapValues() {
  const values = new Uint8Array(4 * 4 * 4);
  values.fill(1, 20, 44);
  values.fill(2, 44);
  return values;
}

const seat = (id: string, name: string, values: Uint8Array) =>
  useImageCacheStore().addVTKImageData(makeImage(values), name, { id });

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

async function restoreTwoGroups(activeValue: number, populate = () => {}) {
  setActivePinia(createPinia());
  populate();
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
  return listMasks(segmentation);
};

// The selection is a type, so what it reactivates is read through the record
// that type has on this image. Both groups decode two segments each, in
// ascending source value, so a segment's place says which value it came from.
const selectedIndex = () => {
  const segmentId = useSegmentStore().segments.selectedSegmentId.value;
  const index = catalog().findIndex(
    (segment) => segment.segmentId === segmentId
  );
  return index === -1 ? undefined : index;
};

describe('restoring a descriptorless active group', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('gives every segment of both groups its own mask', async () => {
    await restoreTwoGroups(1);

    const buffers = catalog().map(
      (segment) => segment.representations.labelmap!.image
    );
    expect(buffers).toHaveLength(4);
    expect(new Set(buffers).size).toBe(4);
  });

  it('activates the segment split from the pending SOURCE value', async () => {
    await restoreTwoGroups(1);

    // Source value 1 of the second group: the third segment restored.
    expect(selectedIndex()).toBe(2);
  });

  it('activates the right segment when the pending value is the later one', async () => {
    await restoreTwoGroups(2);

    expect(selectedIndex()).toBe(3);
  });

  it('leaves a selection the scene already has alone', async () => {
    let liver = '';
    await restoreTwoGroups(1, () => {
      const registry = useSegmentStore().segments;
      liver = registry.segmentNamed('Liver');
      registry.selectSegment(liver);
    });

    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(liver);
  });

  it('leaves the active segment alone when no source value matches', async () => {
    await restoreTwoGroups(7);

    expect(useSegmentStore().segments.selectedSegmentId.value).toBeUndefined();
  });
});

// Two images, each with a descriptorless group of the same name, so both
// decode the same segment names. The second group was hidden in the old file.
const twoImageManifest = (): Manifest =>
  ManifestSchema.parse({
    version: MANIFEST_VERSION,
    dataSources: [
      { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
      { id: 2, type: 'uri', uri: `${BASE_URI}/mr`, name: 'MR Chest' },
      { id: 3, type: 'uri', uri: `${BASE_URI}/a`, name: 'Mask.nrrd' },
      { id: 4, type: 'uri', uri: `${BASE_URI}/b`, name: 'Mask.nrrd' },
    ],
    datasets: [
      { id: 'ds-ct', dataSourceId: 1 },
      { id: 'ds-mr', dataSourceId: 2 },
    ],
    segmentationArtifacts: [
      {
        id: 'sg-a',
        name: 'Mask',
        parentImage: 'ds-ct',
        dataSourceId: 3,
        pendingDecode: true,
      },
      {
        id: 'sg-b',
        name: 'Mask',
        parentImage: 'ds-mr',
        dataSourceId: 4,
        pendingDecode: true,
        pendingVisibility: false,
      },
    ],
  });

describe('restoring same-named descriptorless groups on two images', () => {
  it('keeps the display the second group migrated with', async () => {
    setActivePinia(createPinia());
    seat('ct-store', 'CT Chest', new Uint8Array(4 * 4 * 4));
    seat('mr-store', 'MR Chest', new Uint8Array(4 * 4 * 4));
    seat('a-store', 'Mask.nrrd', makeLabelmapValues());
    seat('b-store', 'Mask.nrrd', makeLabelmapValues());

    await completeStateFileRestore(twoImageManifest(), [], {
      'ds-ct': 'ct-store',
      'ds-mr': 'mr-store',
      [leafStateId(3)]: 'a-store',
      [leafStateId(4)]: 'b-store',
    });

    const registry = useSegmentStore().segments;
    const visibleOn = (imageId: string) =>
      listMasks(useSegmentationStore().getSegmentationForImage(imageId)!).map(
        (mask) => registry.appearanceOf(mask.segmentId).visible
      );
    expect(visibleOn('ct-store')).toEqual([true, true]);
    expect(visibleOn('mr-store')).toEqual([false, false]);
  });
});
