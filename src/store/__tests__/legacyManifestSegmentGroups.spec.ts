import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { resolveArtifactRestoreSources } from '@/src/io/import/processors/restoreStateFile';

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

// No `datasets` root: the legacy composed shape.
const legacyManifest = ManifestSchema.parse({
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
});

function makeImage() {
  const image = vtkImageData.newInstance();
  image.setDimensions([4, 4, 4]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(4 * 4 * 4),
    })
  );
  image.computeTransforms();
  return image;
}

const seatImage = (id: string, name: string) =>
  useImageCacheStore().addVTKImageData(makeImage(), name, { id });

describe('segmentGroups.deserialize — legacy manifests without `datasets`', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ioMocks.readImage.mockReset();
  });

  it('attaches a path-less group via the dataset covering its dataSourceId', async () => {
    seatImage('store-ct', 'CT Chest');
    seatImage('store-seg', 'Tumor');
    const removeSpy = vi.spyOn(useDatasetStore(), 'remove');

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap, skipped } = await store.deserialize(
      legacyManifest,
      [],
      // Restore keys every fallback dataset by its stringified source id.
      { '1': 'store-ct', '3': 'store-seg' },
      resolveArtifactRestoreSources(legacyManifest)
    );

    expect(skipped).toEqual([]);
    expect(idMap['sg-tumor']).toBeDefined();
    expect(
      Object.values(store.metadataByID).some((m) => m.name === 'sg-tumor')
    ).toBe(true);
    // The consumed artifact dataset is removed after conversion.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('store-seg');
  });
});
