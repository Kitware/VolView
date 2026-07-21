import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { leafStateId } from '@/src/io/import/dataSource';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { useMessageStore } from '@/src/store/messages';

// ---------------------------------------------------------------------------
// Resilient segment-group restore:
// deserialize must never hang on a missing dataIDMap key, and one group's
// failure must never reject the whole restore. Skips are NON-silent: deserialize
// returns `{ segmentGroupIDMap, skipped }` where each skip carries a concrete
// reason, and the caller aggregates those (with reasons) into the consolidated
// notice.
// ---------------------------------------------------------------------------

const ioMocks = vi.hoisted(() => ({
  readImage: vi.fn(),
  writeSegmentation: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock('@/src/io/readWriteImage', () => ({
  readImage: ioMocks.readImage,
  writeSegmentation: ioMocks.writeSegmentation,
}));

const BASE_URI = 'volview-backend:base/ct-chest-001';
const ARTIFACT_URI = 'volview-backend:artifact/tumor-seg/v2';
const OTHER_ARTIFACT_URI = 'volview-backend:artifact/liver-seg/v1';

const segments = {
  order: [1],
  byValue: {
    '1': {
      value: 1,
      name: 'Tumor',
      color: [255, 0, 0, 255] as [number, number, number, number],
      visible: true,
    },
  },
};

const group = (
  id: string,
  extras: Record<string, unknown>,
  parentImage = 'ds-ct'
) => ({
  id,
  ...extras,
  metadata: { name: id, parentImage, segments },
});

const manifestWith = (groups: Array<Record<string, unknown>>): Manifest =>
  ManifestSchema.parse({
    version: '6.4.0',
    dataSources: [
      { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
      { id: 3, type: 'uri', uri: ARTIFACT_URI, name: 'Tumor.seg.nrrd' },
      { id: 4, type: 'uri', uri: OTHER_ARTIFACT_URI, name: 'Liver.seg.nrrd' },
    ],
    datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
    segmentGroups: groups,
  });

function makeImage(fillValue = 0) {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(4 * 4 * 4).fill(fillValue),
    })
  );
  image.computeTransforms();
  return image;
}

const seatImage = (id: string, name: string) =>
  useImageCacheStore().addVTKImageData(makeImage(), name, { id });

// An image that IS registered in the cache (imageById) but whose zero-length
// scalars make getVtkImageData return null — so a path-less restore throws
// AFTER the temp artifact has already materialized.
function makeEmptyScalarsImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(0),
    })
  );
  image.computeTransforms();
  return image;
}

describe('segmentGroups.deserialize — resilient restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ioMocks.readImage.mockReset();
  });

  it('skips a path-less group whose artifact never materialized, without hanging', async () => {
    // Before the guard, a missing leaf key for dataSourceId 3 flowed into
    // untilLoaded(undefined) — an await with no timeout. This test completing
    // at all IS the assertion that the hang is gone.
    seatImage('store-ct', 'CT Chest');
    seatImage('store-liver', 'Liver.seg.nrrd');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([
        group('sg-tumor', { dataSourceId: 3 }),
        group('sg-liver', { dataSourceId: 4 }),
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(4)]: 'store-liver' }
    );

    expect(idMap['sg-tumor']).toBeUndefined();
    // The survivor still attaches.
    expect(idMap['sg-liver']).toBeDefined();
    // The drop is reported with a concrete reason, not silent.
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'artifact source unavailable' },
    ]);
  });

  it('skips a group whose parent base never resolved', async () => {
    seatImage('store-seg', 'Tumor.seg.nrrd');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([group('sg-tumor', { dataSourceId: 3 }, 'ds-missing')]),
      [],
      { [leafStateId(3)]: 'store-seg' }
    );

    expect(idMap).toEqual({});
    expect(Object.keys(store.metadataByID)).toEqual([]);
    // Reported with the unresolved-parent reason.
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'parent image did not load' },
    ]);
  });

  it('a read failure skips just that group — survivors still attach', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-liver', 'Liver.seg.nrrd');
    ioMocks.readImage.mockRejectedValue(new Error('corrupt bytes'));

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([
        group('sg-tumor', { path: 'segmentations/Tumor.seg.nrrd' }),
        group('sg-liver', { dataSourceId: 4 }),
      ]),
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { 'ds-ct': 'store-ct', [leafStateId(4)]: 'store-liver' }
    );

    expect(idMap['sg-tumor']).toBeUndefined();
    expect(idMap['sg-liver']).toBeDefined();
    // The read failure is reported with the parse/read reason.
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'could not read/parse labelmap' },
    ]);
  });

  it('surfaces a warning when the full restore skips an unattached group', async () => {
    seatImage('store-ct', 'CT Chest');

    await completeStateFileRestore(
      manifestWith([group('sg-tumor', { dataSourceId: 3 })]),
      [],
      { 'ds-ct': 'store-ct' }
    );

    const warning = useMessageStore().messages.find(
      (message) => message.title === 'Some scene content could not be restored'
    );
    // The notice names the group AND why it was left out.
    expect(warning?.options.details).toContain(
      'segment group: sg-tumor (artifact source unavailable)'
    );
  });

  it('an unresolved base skips its group (with reason) while survivors attach', async () => {
    // `sg-liver`'s base (ds-ct) resolves; `sg-tumor`'s base (ds-missing) does not.
    seatImage('store-ct', 'CT Chest');
    seatImage('store-liver', 'Liver.seg.nrrd');

    const store = useSegmentGroupStore();
    await completeStateFileRestore(
      manifestWith([
        group('sg-tumor', { dataSourceId: 3 }, 'ds-missing'),
        group('sg-liver', { dataSourceId: 4 }),
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(4)]: 'store-liver' }
    );

    // Survivor attaches...
    expect(
      Object.values(store.metadataByID).some((m) => m.name === 'sg-liver')
    ).toBe(true);
    // ...and the dropped group is not restored.
    expect(
      Object.values(store.metadataByID).some((m) => m.name === 'sg-tumor')
    ).toBe(false);

    // ...and the user is told WHY the tumor group was left out.
    const warning = useMessageStore().messages.find(
      (message) => message.title === 'Some scene content could not be restored'
    );
    expect(warning?.options.details).toContain(
      'segment group: sg-tumor (parent image did not load)'
    );
  });

  // -------------------------------------------------------------------------
  // Temporary artifact cleanup (P-08): a path-less group's imported artifact
  // dataset must be removed exactly once, whether the restore succeeds or fails.
  // -------------------------------------------------------------------------

  it('removes the temporary artifact even when the restore fails after import', async () => {
    seatImage('store-ct', 'CT Chest');
    // Materialize the artifact in the cache, but with empty scalars so the load
    // throws AFTER import (getVtkImageData returns null).
    useImageCacheStore().addVTKImageData(
      makeEmptyScalarsImage(),
      'Tumor.seg.nrrd',
      { id: 'store-tumor' }
    );
    expect(useImageCacheStore().imageById).toHaveProperty('store-tumor');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([group('sg-tumor', { dataSourceId: 3 })]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(idMap['sg-tumor']).toBeUndefined();
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'could not read/parse labelmap' },
    ]);
    // Before P-08 the failure path leaked the artifact; now it is cleaned up.
    expect(useImageCacheStore().imageById).not.toHaveProperty('store-tumor');
  });

  it('removes the temporary artifact exactly once on a successful path-less restore', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-tumor', 'Tumor.seg.nrrd');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap } = await store.deserialize(
      manifestWith([group('sg-tumor', { dataSourceId: 3 })]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(idMap['sg-tumor']).toBeDefined();
    // Exactly one cleanup call for the failed group.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('store-tumor');
    expect(useImageCacheStore().imageById).not.toHaveProperty('store-tumor');
  });

  it('restores BOTH path-less groups that share one artifact dataSourceId', async () => {
    // prepareLeafDataSources dedupes leaves by dataSourceId, so two path-less
    // groups referencing the same artifact share ONE temp dataset. Removing it
    // inside each group's `finally` let the first group's cleanup starve the
    // second's getVtkImageData — the second group was dropped as unreadable.
    // The shared temp dataset must survive until BOTH groups settle, then be
    // removed exactly once.
    seatImage('store-ct', 'CT Chest');
    seatImage('store-tumor', 'Tumor.seg.nrrd');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([
        group('sg-a', { dataSourceId: 3 }),
        group('sg-b', { dataSourceId: 3 }),
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(idMap['sg-a']).toBeDefined();
    expect(idMap['sg-b']).toBeDefined();
    expect(skipped).toEqual([]);
    // The shared temp dataset is removed exactly once, after both groups read it.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('store-tumor');
    expect(useImageCacheStore().imageById).not.toHaveProperty('store-tumor');
  });

  it('removes the temp artifact of a group skipped at the parent check', async () => {
    // The base image never resolved but the artifact leaf DID import — with
    // the cleanup set built from attachable groups only, the orphaned labelmap
    // stayed in the dataset store as a stray volume and re-serialized into
    // every future save.
    seatImage('store-seg', 'Tumor.seg.nrrd');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      manifestWith([group('sg-tumor', { dataSourceId: 3 }, 'ds-missing')]),
      [],
      { [leafStateId(3)]: 'store-seg' }
    );

    expect(idMap).toEqual({});
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'parent image did not load' },
    ]);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('store-seg');
    expect(useImageCacheStore().imageById).not.toHaveProperty('store-seg');
  });

  it('does not remove any dataset for an archive-backed (path) group', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('bystander', 'Unrelated');
    ioMocks.readImage.mockResolvedValue(makeImage());
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap } = await store.deserialize(
      manifestWith([
        group('sg-tumor', { path: 'segmentations/Tumor.seg.nrrd' }),
      ]),
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { 'ds-ct': 'store-ct' }
    );

    expect(idMap['sg-tumor']).toBeDefined();
    // Archive-backed groups own no temp artifact — nothing must be removed.
    expect(removeSpy).not.toHaveBeenCalled();
    expect(useImageCacheStore().imageById).toHaveProperty('bystander');
  });
});
