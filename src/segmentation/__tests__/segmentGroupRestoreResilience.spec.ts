import { resolveLabelmapSources } from '@/src/io/import/labelmapImports';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { leafStateId } from '@/src/io/import/dataSource';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { useMessageStore } from '@/src/store/messages';
import { boundMasks } from '@/src/segmentation/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Resilient segment-group restore:
// deserialize must never hang on a missing dataIDMap key, and one group's
// failure must never reject the whole restore. Skips are NON-silent: deserialize
// returns `{ segmentGroupIDMap, skipped }` where each skip carries a concrete
// reason, and the caller aggregates those (with reasons) into the consolidated
// notice.
// ---------------------------------------------------------------------------

const artifactIO = { read: vi.fn(), write: vi.fn() };

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

// Legacy groups reach the stores only through the migration the import path
// runs first, so every fixture here is a migrated 7.0.0 manifest.
const manifestWith = (groups: Array<Record<string, unknown>>): Manifest =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({
        version: '6.4.0',
        dataSources: [
          { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
          { id: 3, type: 'uri', uri: ARTIFACT_URI, name: 'Tumor.seg.nrrd' },
          {
            id: 4,
            type: 'uri',
            uri: OTHER_ARTIFACT_URI,
            name: 'Liver.seg.nrrd',
          },
        ],
        datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
        segmentGroups: groups,
      })
    )
  );

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

// Mirrors production: the restore setup resolves each group's artifact state
// source from the manifest (resolveLabelmapSources, the single-owner
// policy) and hands it to deserialize alongside the dataIDMap. A restored
// legacy group is split into one bounded mask per segment, so what a survivor
// leaves behind is its segments, not a group record.
const maskCount = () => boundMasks().length;

/** The image's segments that ended up with storage. */
const catalogFor = (parentImageId: string) => {
  const segmentation =
    useSegmentationStore().getSegmentationForImage(parentImageId);
  if (!segmentation) return [];
  return segmentation.order
    .map((id) => segmentation.masks[id])
    .filter((segment) => segment.representations.labelmap);
};

const nameOf = (segment: { segmentId: string }) =>
  useSegmentStore().segments.appearanceOf(segment.segmentId).name;

const restoreGroups = (
  manifest: Manifest,
  stateFiles: { archivePath: string; file: File }[],
  dataIDMap: Record<string, string>
) =>
  useSegmentationStore().deserialize({
    manifest,
    stateFiles,
    dataIDMap,
    segmentIdMap: useSegmentStore().deserialize(manifest),
    labelmapSources: resolveLabelmapSources(manifest),
    io: artifactIO,
  });

/** A group whose parent base never resolved, restored against a seated mask. */
const restoreOrphanedGroup = () =>
  restoreGroups(
    manifestWith([group('sg-tumor', { dataSourceId: 3 }, 'ds-missing')]),
    [],
    { [leafStateId(3)]: 'store-seg' }
  );

describe('migrated segment groups: resilient restore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    artifactIO.read.mockReset();
  });

  // Tumor beside a liver group that always restores, so a skip is shown to be
  // scoped to the group that caused it.
  const restoreTumorBesideLiver = (
    tumorSource: Record<string, unknown>,
    stateFiles: Array<{ archivePath: string; file: File }> = []
  ) => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-liver', 'Liver.seg.nrrd');
    return restoreGroups(
      manifestWith([
        group('sg-tumor', tumorSource),
        group('sg-liver', { dataSourceId: 4 }),
      ]),
      stateFiles,
      { 'ds-ct': 'store-ct', [leafStateId(4)]: 'store-liver' }
    );
  };

  it('skips a path-less group whose artifact never materialized, without hanging', async () => {
    const { restoredImportIds: groups, skipped } =
      await restoreTumorBesideLiver({ dataSourceId: 3 });

    expect(groups.has('sg-tumor')).toBe(false);
    expect(groups.has('sg-liver')).toBe(true);
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'labelmap source unavailable' },
    ]);
    const restored = catalogFor('store-ct');
    expect(restored.map((segment) => nameOf(segment))).toEqual(['Tumor']);
    expect([
      ...useSegmentStore().segments.appearanceOf(restored[0].segmentId).color,
    ]).toEqual([255, 0, 0, 255]);
    expect(maskCount()).toBe(1);
  });

  // A group that named no segments has its voxels enumerated instead, and an
  // all-background labelmap enumerates none: it reaches the scene as nothing
  // at all, and says so rather than restoring an empty entry.
  it('skips a group whose labelmap holds no segments', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-blank', 'Blank.seg.nrrd');

    const { restoredImportIds: groups, skipped } = await restoreGroups(
      manifestWith([
        {
          id: 'sg-blank',
          dataSourceId: 3,
          metadata: { name: 'sg-blank', parentImage: 'ds-ct' },
        },
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-blank' }
    );

    expect(groups).toEqual(new Set());
    expect(boundMasks()).toEqual([]);
    expect(skipped).toEqual([
      { name: 'sg-blank', reason: 'labelmap holds no segments' },
    ]);
  });

  it('skips a group whose parent base never resolved', async () => {
    seatImage('store-seg', 'Tumor.seg.nrrd');

    const { restoredImportIds: groups, skipped } = await restoreOrphanedGroup();

    expect(groups).toEqual(new Set());
    expect(boundMasks()).toEqual([]);
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'parent image did not load' },
    ]);
  });

  it('a read failure skips just that group — survivors still attach', async () => {
    artifactIO.read.mockRejectedValue(new Error('corrupt bytes'));

    const { restoredImportIds: groups, skipped } =
      await restoreTumorBesideLiver({ path: 'segmentations/Tumor.seg.nrrd' }, [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ]);

    expect(groups.has('sg-tumor')).toBe(false);
    expect(groups.has('sg-liver')).toBe(true);
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
    expect(warning?.options.details).toContain(
      'segmentation: sg-tumor (labelmap source unavailable)'
    );
  });

  it('an unresolved base skips its group (with reason) while survivors attach', async () => {
    // `sg-liver`'s base (ds-ct) resolves; `sg-tumor`'s base (ds-missing) does not.
    seatImage('store-ct', 'CT Chest');
    seatImage('store-liver', 'Liver.seg.nrrd');

    await completeStateFileRestore(
      manifestWith([
        group('sg-tumor', { dataSourceId: 3 }, 'ds-missing'),
        group('sg-liver', { dataSourceId: 4 }),
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(4)]: 'store-liver' }
    );

    // Only the survivor's segments attached.
    expect(catalogFor('store-ct').map((segment) => nameOf(segment))).toEqual([
      'Tumor',
    ]);
    expect(maskCount()).toBe(1);

    const warning = useMessageStore().messages.find(
      (message) => message.title === 'Some scene content could not be restored'
    );
    expect(warning?.options.details).toContain(
      'segmentation: sg-tumor (parent image did not load)'
    );
  });

  // -------------------------------------------------------------------------
  // Temporary artifact cleanup: a path-less group's imported artifact
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

    const { restoredImportIds: groups, skipped } = await restoreGroups(
      manifestWith([group('sg-tumor', { dataSourceId: 3 })]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(groups.has('sg-tumor')).toBe(false);
    expect(skipped).toEqual([
      { name: 'sg-tumor', reason: 'could not read/parse labelmap' },
    ]);
    expect(useImageCacheStore().imageById).not.toHaveProperty('store-tumor');
  });

  it('removes the temporary artifact exactly once on a successful path-less restore', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-tumor', 'Tumor.seg.nrrd');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const { restoredImportIds: groups } = await restoreGroups(
      manifestWith([group('sg-tumor', { dataSourceId: 3 })]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(groups.has('sg-tumor')).toBe(true);
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

    const { restoredImportIds: groups, skipped } = await restoreGroups(
      manifestWith([
        group('sg-a', { dataSourceId: 3 }),
        group('sg-b', { dataSourceId: 3 }),
      ]),
      [],
      { 'ds-ct': 'store-ct', [leafStateId(3)]: 'store-tumor' }
    );

    expect(groups.has('sg-a')).toBe(true);
    expect(groups.has('sg-b')).toBe(true);
    expect(skipped).toEqual([]);
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

    const { restoredImportIds: groups, skipped } = await restoreOrphanedGroup();

    expect(groups).toEqual(new Set());
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
    artifactIO.read.mockResolvedValue({ image: makeImage() });
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const { restoredImportIds: groups } = await restoreGroups(
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

    expect(groups.has('sg-tumor')).toBe(true);
    // Archive-backed groups own no temp artifact — nothing must be removed.
    expect(removeSpy).not.toHaveBeenCalled();
    expect(useImageCacheStore().imageById).toHaveProperty('bystander');
  });

  it('does not remove an explicit dataset shared with a path-less group', async () => {
    seatImage('store-ct', 'CT Chest');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');
    const manifest = manifestWith([group('sg-shared', { dataSourceId: 1 })]);

    const { restoredImportIds: groups, skipped } = await restoreGroups(
      manifest,
      [],
      { 'ds-ct': 'store-ct' }
    );

    expect(groups.has('sg-shared')).toBe(true);
    expect(skipped).toEqual([]);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(useImageCacheStore().imageById).toHaveProperty('store-ct');
  });
});
