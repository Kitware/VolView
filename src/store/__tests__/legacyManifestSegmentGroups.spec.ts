import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { makeSpecImage } from '@/src/store/__tests__/segmentMaskFixtures';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { resolveArtifactRestoreSources } from '@/src/io/import/processors/restoreStateFile';
import { listMasks } from '@/src/types/segmentation';

// ---------------------------------------------------------------------------
// Backward compatibility: manifests saved before `datasets` existed (and
// composed manifest.json launches, e.g. girder_volview's) carry only
// `dataSources`, and their path-less segment groups reference the labelmap by
// `dataSourceId`. On restore every uri source stands in for a dataset keyed by
// its stringified source id — so the group's artifact resolves through that
// covering dataset, exactly as it did on main, and the consumed artifact
// dataset is removed after conversion.
// ---------------------------------------------------------------------------

const ioMocks = vi.hoisted(() => ({
  readImage: vi.fn(),
  writeSegmentation: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

// eslint-disable-next-line no-restricted-syntax -- ITK-wasm image IO has no counterpart in the node test environment
vi.mock('@/src/io/readWriteImage', () => ({
  readImage: ioMocks.readImage,
  writeSegmentation: ioMocks.writeSegmentation,
}));

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

// No `datasets` root: the legacy composed shape, read through the migration
// the import path runs before anything touches a store.
const legacyManifest = ManifestSchema.parse(
  migrateManifest(
    JSON.stringify({
      version: '6.4.0',
      dataSources: [
        { id: 1, type: 'uri', uri: 'https://ex/ct.nrrd', name: 'CT Chest' },
        { id: 3, type: 'uri', uri: 'https://ex/tumor.seg.nrrd', name: 'Tumor' },
      ],
      segmentGroups: [
        {
          id: 'sg-tumor',
          dataSourceId: 3,
          metadata: { name: 'sg-tumor', parentImage: '1', segments },
        },
      ],
    })
  )
);

/** The plain 4x4x4 parent every restore in this spec hangs off. */
const makeImage = () => makeSpecImage();

const seatImage = (id: string, name: string) =>
  useImageCacheStore().addVTKImageData(makeImage(), name, { id });

describe('migrated legacy manifests without `datasets`', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ioMocks.readImage.mockReset();
  });

  it('attaches a path-less group via the dataset covering its dataSourceId', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-seg', 'Tumor');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentationStore();
    const { artifactIdMap: idMap, skipped } = await store.deserialize({
      manifest: legacyManifest,
      stateFiles: [],
      // Restore keys every fallback dataset by its stringified source id.
      dataIDMap: { '1': 'store-ct', '3': 'store-seg' },
      segmentIdMap: useSegmentStore().deserialize(legacyManifest),
      artifactSources: resolveArtifactRestoreSources(legacyManifest),
    });

    expect(skipped).toEqual([]);
    expect(idMap['sg-tumor']).toBeDefined();
    // The consumed artifact dataset is removed after conversion.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('store-seg');

    // The migrated descriptor restored as a segment with its own bounded mask.
    const segmentation = store.getSegmentationForImage('store-ct')!;
    expect(
      listMasks(segmentation).map((segment) => ({
        name: useSegmentStore().segments.appearanceOf(segment.segmentId).name,
        labelValue: segment.representations.labelmap!.labelValue,
      }))
    ).toEqual([{ name: 'Tumor', labelValue: 1 }]);
  });
});
