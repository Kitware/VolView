import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import {
  restoreStateFile,
  resolveArtifactRestoreSources,
} from '@/src/io/import/processors/restoreStateFile';
import type { StateFileSetupResult } from '@/src/io/import/common';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useImageCacheStore } from '@/src/store/image-cache';

// ---------------------------------------------------------------------------
// Disjoint restore stateID namespaces: a composed
// manifest reuses the saved scene's dataset ids verbatim (`datasets[].id`,
// small client-minted integer strings) while numbering `dataSources[].id`
// fresh (1..N, bases first, artifacts after). A segment group's synthesized
// leaf stateID derives from its artifact `dataSourceId` — so a saved base
// dataset id like "2" can equal `String(2)` of the artifact's dataSource.
// Both loadables then write the SAME `stateIDToStoreID` key and the winner is
// leaf completion order: the restore either builds the labelmap from the
// base's voxels and DELETES the base, or parents the group on the temp
// dataset it is about to remove. Synthesized leaf ids therefore live in their
// own namespace, making the collision impossible by construction, while
// scene-recorded dataset ids stay verbatim (existing saved scenes restore
// unchanged).
// ---------------------------------------------------------------------------

// `writeSegmentation` spawns a real Worker; keep the IO module out of the test.
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

const BASE_STORE_ID = 'store-base';
const ARTIFACT_STORE_ID = 'store-artifact';

const storeIdByUri: Record<string, string> = {
  [BASE_URI]: BASE_STORE_ID,
  [ARTIFACT_URI]: ARTIFACT_STORE_ID,
};

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

// The collision shape a real save/compose round-trip produces: at save time a
// small artifact finished first and took client dataset id "1", so the base
// got "2"; the next compose numbers dataSources fresh — base 1, artifact 2 —
// and the saved dataset id "2" now equals the artifact's dataSourceId.
const collisionManifest = () => ({
  version: '6.4.0',
  dataSources: [
    { id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' },
    { id: 2, type: 'uri', uri: ARTIFACT_URI, name: 'Tumor.seg.nrrd' },
  ],
  datasets: [{ id: '2', dataSourceId: 1 }],
  primarySelection: '2',
  segmentGroups: [
    {
      id: 'sg-tumor',
      dataSourceId: 2,
      metadata: { name: 'Tumor', parentImage: '2', segments },
    },
  ],
});

type UriLeaf = {
  type: 'uri';
  uri: string;
  stateFileLeaf?: { stateID: string };
};

async function prepareLeaves(manifest: Record<string, unknown>) {
  const file = new File([JSON.stringify(manifest)], 'session.volview.json', {
    type: 'application/json',
  });
  const result = await restoreStateFile({
    type: 'file',
    file,
    fileType: 'application/json',
  });
  expect((result as StateFileSetupResult).type).toBe('stateFileSetup');
  return result as StateFileSetupResult;
}

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

const seatImage = (id: string, name: string, fillValue = 0) =>
  useImageCacheStore().addVTKImageData(makeImage(fillValue), name, { id });

// Replays importDataSources' map assembly (stateIDToStoreID[leaf.stateID] =
// dataID, in leaf COMPLETION order — last write wins), which is exactly where
// the collision landed.
const assembleStateIdMap = (leaves: UriLeaf[], completionOrder: string[]) =>
  completionOrder.reduce<Record<string, string>>((map, uri) => {
    const leaf = leaves.find((l) => l.uri === uri);
    expect(leaf?.stateFileLeaf).toBeDefined();
    return { ...map, [leaf!.stateFileLeaf!.stateID]: storeIdByUri[uri] };
  }, {});

describe('restore stateID namespaces (collision)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ioMocks.readImage.mockReset();
  });

  it('mints disjoint stateIDs for a dataset and a leaf sharing the numeral', async () => {
    const setup = await prepareLeaves(collisionManifest());
    const leaves = setup.dataSources as UriLeaf[];

    const base = leaves.find((leaf) => leaf.uri === BASE_URI);
    const artifact = leaves.find((leaf) => leaf.uri === ARTIFACT_URI);

    // Scene-recorded dataset ids ride verbatim — existing saved scenes keep
    // their plain ids.
    expect(base!.stateFileLeaf).toEqual({ stateID: '2' });
    // The synthesized artifact leaf can never take a dataset id's key.
    expect(artifact!.stateFileLeaf).toBeDefined();
    expect(artifact!.stateFileLeaf!.stateID).not.toBe('2');
  });

  it.each([
    { label: 'base finishes last', completionOrder: [ARTIFACT_URI, BASE_URI] },
    {
      label: 'artifact finishes last',
      completionOrder: [BASE_URI, ARTIFACT_URI],
    },
  ])(
    'restores both loadables correctly when the $label',
    async ({ completionOrder }) => {
      const setup = await prepareLeaves(collisionManifest());
      const leaves = setup.dataSources as UriLeaf[];
      const stateIDToStoreID = assembleStateIdMap(leaves, completionOrder);

      const imageCache = useImageCacheStore();
      seatImage(BASE_STORE_ID, 'CT Chest', 0);
      seatImage(ARTIFACT_STORE_ID, 'Tumor.seg.nrrd', 1);

      const store = useSegmentGroupStore();
      const { segmentGroupIDMap: idMap } = await store.deserialize(
        setup.manifest,
        [],
        stateIDToStoreID,
        resolveArtifactRestoreSources(setup.manifest)
      );

      // The group attached, parented on the BASE dataset's store id.
      const groupId = idMap['sg-tumor'];
      expect(groupId).toBeDefined();
      expect(store.metadataByID[groupId].parentImage).toBe(BASE_STORE_ID);

      // Its labelmap was built from the ARTIFACT's voxels, not the base's.
      const scalars = store.dataIndex[groupId]
        .getPointData()
        .getScalars()
        .getData() as Uint8Array;
      expect(Array.from(new Set(scalars))).toEqual([1]);

      // The base dataset survived; only the consumed temp dataset is gone.
      expect(imageCache.getVtkImageData(BASE_STORE_ID)).toBeTruthy();
      expect(imageCache.getVtkImageData(ARTIFACT_STORE_ID)).toBeFalsy();
    }
  );

  it('restores a saved-scene zip manifest through plain dataset ids, unchanged', async () => {
    // A client-saved zip: the group's bytes ride under `path`, and dataIDMap
    // is keyed by the scene's own dataset ids — numeric strings included.
    // Those keys must keep working with no prefix (wire compat with every
    // existing saved scene).
    seatImage(BASE_STORE_ID, 'CT Chest', 0);
    ioMocks.readImage.mockResolvedValue({ image: makeImage(7) });

    const setup = await prepareLeaves({
      version: '6.4.0',
      dataSources: [{ id: 1, type: 'uri', uri: BASE_URI, name: 'CT Chest' }],
      datasets: [{ id: '2', dataSourceId: 1 }],
      segmentGroups: [
        {
          id: 'sg-tumor',
          path: 'segmentations/Tumor.seg.nrrd',
          metadata: { name: 'Tumor', parentImage: '2', segments },
        },
      ],
    });

    const store = useSegmentGroupStore();
    const { segmentGroupIDMap: idMap } = await store.deserialize(
      setup.manifest,
      [
        {
          archivePath: 'segmentations/Tumor.seg.nrrd',
          file: new File([''], 'Tumor.seg.nrrd'),
        },
      ],
      { '2': BASE_STORE_ID },
      resolveArtifactRestoreSources(setup.manifest)
    );

    const groupId = idMap['sg-tumor'];
    expect(groupId).toBeDefined();
    expect(store.metadataByID[groupId].parentImage).toBe(BASE_STORE_ID);
    expect(ioMocks.readImage).toHaveBeenCalledTimes(1);
  });
});
