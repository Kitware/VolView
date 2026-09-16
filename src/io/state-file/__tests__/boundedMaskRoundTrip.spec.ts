import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { listMasks } from '@/src/segmentation/model';
import { isEmptyExtent } from '@/src/segmentation/geometry';
import { type LabelmapIO } from '@/src/segmentation/store';
import {
  addMask,
  inMemoryArtifactIO,
  manifestForImages,
  serializeToStateFiles,
  extentOf,
  markedVoxels,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  voxelCount,
  type Index3,
  boundMasks,
  compositeLabelmap,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { labelmapScalars } from '@/src/segmentation/io/labelmap';

// ---------------------------------------------------------------------------
// The state file carries N bounded masks. What goes into the archive is each
// segment's own mask at its own size, and what the binding's `extent` says is
// where that mask sits in the parent image. Restoring puts every segment back
// on the same parent voxels, which is the only thing a state file has to
// promise: the mask's dimensions are storage, its extent is meaning.
//
// A materialized mask that covers nothing is a real state, so an empty extent
// restores as an empty mask.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];
const GRID = {
  dimensions: DIMENSIONS,
  spacing: [2, 3, 4] as [number, number, number],
  origin: [10, 20, 30] as [number, number, number],
};

const nameOf = (mask: { segmentId: string }) =>
  useSegmentStore().segments.appearanceOf(mask.segmentId).name;

const snapshot = (imageId: string) =>
  listMasks(store().getSegmentationForImage(imageId)!).map((mask) => ({
    name: nameOf(mask),
    extent: mask.representations.labelmap
      ? [...mask.representations.labelmap.extent]
      : undefined,
    dimensions: mask.representations.labelmap
      ? store().maskVoxels(mask.id).image().getDimensions()
      : undefined,
    marks: markedVoxels(mask.id),
  }));

const wireSegmentation = (manifest: any) =>
  manifest.segmentations.find((entry: any) => entry.parentImage === 'img-1');

const wireSegmentId = (manifest: any, name: string) =>
  manifest.segments.find((segment: any) => segment.name === name)?.id;

const wireMask = (manifest: any, name: string) =>
  wireSegmentation(manifest).masks.find(
    (mask: any) => mask.segmentId === wireSegmentId(manifest, name)
  );

const wireStorage = (mask: any) => ({
  path: mask.representations.labelmap.path,
  name: mask.representations.labelmap.name,
});

function pointNodeAtTumorEntry(manifest: any) {
  const segmentation = wireSegmentation(manifest);
  const tumor = wireMask(manifest, 'Tumor');
  const node = wireMask(manifest, 'Node');
  const tumorStorage = wireStorage(tumor);
  const nodePath = node.representations.labelmap.path;
  node.representations.labelmap.path = tumorStorage.path;
  node.representations.labelmap.name = tumorStorage.name;
  return { segmentation, tumor, node, tumorStorage, nodePath };
}

const restoredMask = (name: string) =>
  listMasks(store().getSegmentationForImage('new-1')!).find(
    (mask) => nameOf(mask) === name
  )!;

// Tumor's mask starts at parent index [1, 1, 1].
const expectTumorOnParentGrid = () => {
  const mask = store().maskVoxels(restoredMask('Tumor').id).image();
  const parent = parentImage('new-1');
  expect(Array.from(mask.indexToWorld([1, 0, 0] as never))).toEqual(
    Array.from(parent.indexToWorld([2, 1, 1] as never))
  );
  expect(Array.from(mask.getDirection())).toEqual(
    Array.from(parent.getDirection())
  );
};

async function buildScene() {
  await seatImage('img-1', { ...GRID, name: 'CT A' });
  await seatImage('img-2', { ...GRID, name: 'CT B' });

  const tumor = addMask('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  seedVoxel(tumor, [2, 1, 1]);
  const node = addMask('img-1', 'Node');
  seedVoxel(node, [3, 3, 3]);
  // Materialized and never drawn on: storage exists and covers nothing.
  const planned = addMask('img-1', 'Planned');
  store().maskVoxels(planned).materialize();
  addMask('img-1', 'Unbound');

  const other = addMask('img-2', 'Tumor');
  seedVoxel(other, [0, 0, 0]);
  await nextTick();
}

const emptyManifest = () => manifestForImages(['img-1', 'img-2']);

async function roundTrip(io: LabelmapIO, tamper?: (manifest: any) => void) {
  const { parsed, stateFiles } = await serializeToStateFiles(
    emptyManifest(),
    io,
    tamper
  );

  setActivePinia(createPinia());
  await seatImage('new-1', { ...GRID, name: 'CT A' });
  await seatImage('new-2', { ...GRID, name: 'CT B' });
  const result = await store().deserialize({
    manifest: parsed,
    stateFiles: stateFiles,
    dataIDMap: { 'img-1': 'new-1', 'img-2': 'new-2' },
    segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
    io: io,
  });
  await nextTick();
  return result;
}

describe('bounded masks through the state file', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores every segment onto the parent voxels it had', async () => {
    await buildScene();
    const before = {
      first: snapshot('img-1'),
      second: snapshot('img-2'),
    };

    await roundTrip(inMemoryArtifactIO());

    expect(snapshot('new-1')).toEqual(before.first);
    // The session repeats the name, so the later segment restores numbered.
    expect(snapshot('new-2')).toEqual([
      { ...before.second[0], name: 'Tumor (2)' },
    ]);
    // Spelled out once, so the equality above cannot pass on two full-extent
    // masks that happen to match each other.
    expect(snapshot('new-1')[0]).toMatchObject({
      name: 'Tumor',
      extent: [1, 2, 1, 1, 1, 1],
      dimensions: [2, 1, 1],
      marks: [
        [1, 1, 1, 1],
        [2, 1, 1, 1],
      ],
    });
  });

  it('adds another copy with the original voxels when a scene is restored twice', async () => {
    await buildScene();
    const io = inMemoryArtifactIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      emptyManifest(),
      io
    );
    const dataIDMap = { 'img-1': 'img-1', 'img-2': 'img-2' };

    setActivePinia(createPinia());
    await seatImage('img-1', { ...GRID, name: 'CT A' });
    await seatImage('img-2', { ...GRID, name: 'CT B' });
    // Each import adopts the incoming registry afresh, so the second pass
    // brings its own segments rather than landing on the first pass's records.
    const restore = () =>
      store().deserialize({
        manifest: parsed,
        stateFiles: stateFiles,
        dataIDMap: dataIDMap,
        segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
        io: io,
      });
    await restore();
    await restore();
    await nextTick();

    const savedIO = inMemoryArtifactIO();
    const { parsed: saved, stateFiles: savedFiles } =
      await serializeToStateFiles(emptyManifest(), savedIO);
    const snapshotsByPath = new Map(
      await Promise.all(
        savedFiles.map(async ({ archivePath, file }) => {
          const index = Number((await file.text()).split('-')[1]);
          return [archivePath, savedIO.snapshots[index]] as const;
        })
      )
    );
    const content = saved.segmentations.map((segmentation: any) => ({
      parent: segmentation.parentImage,
      masks: segmentation.masks.map((mask: any) => {
        const binding = mask.representations.labelmap;
        return {
          name: saved.segments.find(
            (segment: any) => segment.id === mask.segmentId
          ).name,
          extent: binding?.extent,
          ...snapshotsByPath.get(binding?.path),
        };
      }),
    }));
    const tumor = {
      extent: [1, 2, 1, 1, 1, 1],
      dimensions: [2, 1, 1],
      values: [1, 1],
    };
    const node = {
      extent: [3, 3, 3, 3, 3, 3],
      dimensions: [1, 1, 1],
      values: [1],
    };
    const planned = {
      extent: [0, -1, 0, -1, 0, -1],
      dimensions: [1, 1, 1],
      values: [0],
    };
    const other = {
      extent: [0, 0, 0, 0, 0, 0],
      dimensions: [1, 1, 1],
      values: [1],
    };
    expect(content).toEqual([
      {
        parent: 'img-1',
        masks: [
          { name: 'Tumor', ...tumor },
          { name: 'Node', ...node },
          { name: 'Planned', ...planned },
          { name: 'Unbound', extent: undefined },
          { name: 'Tumor (3)', ...tumor },
          { name: 'Node (2)', ...node },
          { name: 'Planned (2)', ...planned },
          { name: 'Unbound (2)', extent: undefined },
        ],
      },
      {
        parent: 'img-2',
        masks: [
          { name: 'Tumor (2)', ...other },
          { name: 'Tumor (4)', ...other },
        ],
      },
    ]);
  });

  it('leaves an existing image display alone when a scene is imported onto it', async () => {
    await buildScene();
    const io = inMemoryArtifactIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      emptyManifest(),
      io
    );

    // The scene the user is in already has masks and a display of its own.
    setActivePinia(createPinia());
    await seatImage('img-1', { ...GRID, name: 'CT C' });
    await seatImage('img-2', { ...GRID, name: 'CT B' });
    const mine = addMask('img-1', 'Mine');
    seedVoxel(mine, [0, 0, 0]);
    const segmentation = store().getSegmentationForImage('img-1')!;
    store().updateSegmentationDisplay(segmentation.id, {
      fillOpacity: 0.9,
      outlineThickness: 7,
    });

    await store().deserialize({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'img-1', 'img-2': 'img-2' },
      segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
      io: io,
    });
    await nextTick();

    expect(segmentation.fillOpacity).toBe(0.9);
    expect(segmentation.outlineThickness).toBe(7);
    expect(segmentation.name).toBe('CT C');
    // The import still landed beside what was there.
    expect(segmentation.order).toHaveLength(5);
    expect(markedVoxels(mine)).toEqual([[0, 0, 0, 1]]);
  });

  it('keeps bindings distinct when wire segmentation and segment ids repeat', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const first = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-1'
      );
      const second = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-2'
      );
      const tumorSegmentIds = manifest.segments
        .filter((segment: any) => segment.name === 'Tumor')
        .map((segment: any) => segment.id);
      const findTumor = (segmentation: any) =>
        segmentation.masks.find((mask: any) =>
          tumorSegmentIds.includes(mask.segmentId)
        );
      const firstTumor = findTumor(first);
      const secondTumor = findTumor(second);

      first.id = 'duplicate-segmentation';
      second.id = 'duplicate-segmentation';
      first.order = first.order.map((id: string) =>
        id === firstTumor.id ? 'duplicate-segment' : id
      );
      second.order = second.order.map((id: string) =>
        id === secondTumor.id ? 'duplicate-segment' : id
      );
      firstTumor.id = 'duplicate-segment';
      secondTumor.id = 'duplicate-segment';
    });

    const firstTumor = listMasks(
      store().getSegmentationForImage('new-1')!
    ).find((mask) => nameOf(mask) === 'Tumor')!;
    const secondTumor = listMasks(
      store().getSegmentationForImage('new-2')!
    ).find((mask) => nameOf(mask) === 'Tumor (2)')!;
    expect(firstTumor.representations.labelmap).toBeDefined();
    expect(secondTumor.representations.labelmap).toBeDefined();
    expect(markedVoxels(firstTumor.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(markedVoxels(secondTumor.id)).toEqual([[0, 0, 0, 1]]);
    expect(firstTumor.representations.labelmap!.image).not.toBe(
      secondTumor.representations.labelmap!.image
    );
    expect(boundMasks()).toHaveLength(4);
  });

  it('restores a mask that covers nothing as one that covers nothing', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO());

    const planned = listMasks(store().getSegmentationForImage('new-1')!).find(
      (mask) => nameOf(mask) === 'Planned'
    )!;
    expect(planned.representations.labelmap).toBeDefined();
    expect(isEmptyExtent(extentOf(planned.id)!)).toBe(true);
    expect(store().maskVoxels(planned.id).scalars()).toHaveLength(0);
  });

  it('leaves a segment that never had storage without any', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO());

    const unbound = listMasks(store().getSegmentationForImage('new-1')!).find(
      (mask) => nameOf(mask) === 'Unbound'
    )!;
    expect(unbound.representations.labelmap).toBeUndefined();
  });

  it('leaves a segment unbound when its entry belongs to another image', async () => {
    await buildScene();

    // A mask sits on its parent's grid, so an entry saved for another image
    // gives this segment storage of a shape its own extent cannot describe.
    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const foreign = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-2'
      );
      const tumor = wireMask(manifest, 'Tumor');
      tumor.representations.labelmap.path =
        foreign.masks[0].representations.labelmap.path;
    });

    const restored = listMasks(store().getSegmentationForImage('new-1')!);
    const named = (name: string) =>
      restored.find((mask) => nameOf(mask) === name)!;
    expect(named('Tumor').representations.labelmap).toBeUndefined();
    // The image's other segments restore as they were.
    expect(named('Node').representations.labelmap).toBeDefined();
    expect(markedVoxels(named('Node').id)).toEqual([[3, 3, 3, SEGMENT_VALUE]]);
  });

  it('rejects an empty extent that points at foreground mask data', async () => {
    await buildScene();

    let storage: ReturnType<typeof wireStorage>;
    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const tumor = wireMask(manifest, 'Tumor');
      storage = wireStorage(tumor);
      tumor.representations.labelmap.extent = [0, -1, 0, -1, 0, -1];
    });

    const tumor = restoredMask('Tumor');
    expect(tumor.representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: storage!.name,
      reason: 'empty extent references a mask with foreground voxels',
    });
    expect(boundMasks()).toHaveLength(3);
  });

  // Each mask reads its own archive entry into its own buffer, so two masks
  // naming one entry get a copy each and neither aliases the other's voxels.
  it('gives two masks naming one entry storage of their own', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const refs = pointNodeAtTumorEntry(manifest);
      refs.node.representations.labelmap.extent = [1, 2, 1, 1, 1, 1];
    });

    const tumor = restoredMask('Tumor');
    const node = restoredMask('Node');
    expect(store().maskVoxels(tumor.id).image()).not.toBe(
      store().maskVoxels(node.id).image()
    );
    expect(markedVoxels(tumor.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(markedVoxels(node.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(boundMasks()).toHaveLength(4);
  });

  it('does not let an earlier empty binding erase a later valid binding', async () => {
    await buildScene();

    let refs: ReturnType<typeof pointNodeAtTumorEntry>;
    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      refs = pointNodeAtTumorEntry(manifest);
      refs.node.representations.labelmap.extent = [0, -1, 0, -1, 0, -1];
      refs.segmentation.order = [
        refs.node.id,
        ...refs.segmentation.order.filter((id: string) => id !== refs.node.id),
      ];
    });

    const tumor = restoredMask('Tumor');
    expect(restoredMask('Node').representations.labelmap).toBeUndefined();
    expect(store().maskVoxels(tumor.id).image().getDimensions()).toEqual([
      2, 1, 1,
    ]);
    expect(markedVoxels(tumor.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(result.skipped).toContainEqual({
      name: refs!.tumorStorage.name,
      reason: 'empty extent references a mask with foreground voxels',
    });
  });

  it.each([
    {
      title: 'an extent whose size differs from its loaded mask',
      extent: [1, 3, 1, 1, 1, 1],
      reason: 'extent does not match the loaded mask dimensions',
    },
    {
      title: 'an extent that leaves its parent image',
      extent: [3, 4, 1, 1, 1, 1],
      reason: 'extent leaves the parent image',
    },
    {
      title: 'an extent with fractional coordinates',
      extent: [0.5, 1.5, 1, 1, 1, 1],
      reason: 'extent coordinates must be finite integers',
    },
    {
      title: 'a fractional extent whose axes otherwise look empty',
      extent: [0.5, -0.5, 0, -1, 0, -1],
      reason: 'extent coordinates must be finite integers',
    },
  ])('rejects $title', async ({ extent, reason }) => {
    await buildScene();

    let storage: ReturnType<typeof wireStorage>;
    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const tumor = wireMask(manifest, 'Tumor');
      storage = wireStorage(tumor);
      tumor.representations.labelmap.extent = extent;
    });

    expect(restoredMask('Tumor').representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({ name: storage!.name, reason });
    expect(markedVoxels(restoredMask('Node').id)).toEqual([
      [3, 3, 3, SEGMENT_VALUE],
    ]);
    expect(
      Array.from(labelmapScalars(compositeLabelmap('new-1').labelmap)).flatMap(
        (value, index) => (value === 0 ? [] : [[index, value]])
      )
    ).toEqual([[63, 2]]);
    expect(boundMasks()).toHaveLength(3);
  });

  it('keeps a valid binding when another naming the same entry is invalid', async () => {
    await buildScene();

    // Node keeps its own extent, which does not describe Tumor's entry.
    let refs: ReturnType<typeof pointNodeAtTumorEntry>;
    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      refs = pointNodeAtTumorEntry(manifest);
    });

    expect(restoredMask('Tumor').representations.labelmap).toBeDefined();
    expect(restoredMask('Node').representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: refs!.tumorStorage.name,
      reason: 'extent does not match the loaded mask dimensions',
    });
  });

  it('puts a mask on the parent grid whatever geometry its codec kept', async () => {
    await buildScene();
    const io = inMemoryArtifactIO();

    // A codec that stores no spacing or direction reads back other ones.
    await roundTrip(io, () =>
      io.written.forEach((labelmap) => {
        labelmap.setSpacing([1, 1, 1]);
        labelmap.setDirection([0, 1, 0, 1, 0, 0, 0, 0, 1]);
      })
    );

    expectTumorOnParentGrid();
  });
});

// A labelmap without segment descriptors derives segment identities from its values.
const seatLegacyPair = async () => {
  await seatImage('parent-store', { ...GRID, name: 'CT Chest' });
  const values = new Uint8Array(voxelCount(DIMENSIONS));
  values[1 + 1 * 4 + 1 * 16] = 1;
  values[3 + 3 * 4 + 3 * 16] = 2;
  return seatImage('artifact-store', {
    ...GRID,
    name: 'Tumor.seg.nrrd',
    values,
  });
};

const legacyPairManifest = (scene: Record<string, unknown>) =>
  ManifestSchema.parse(
    migrateManifest(
      JSON.stringify({
        dataSources: [
          { id: 1, type: 'uri', uri: 'volview-backend:base/ct', name: 'CT' },
          {
            id: 3,
            type: 'uri',
            uri: 'volview-backend:artifact/tumor',
            name: 'Tumor.seg.nrrd',
            mime: 'application/octet-stream',
          },
        ],
        datasets: [{ id: 'ds-ct', dataSourceId: 1 }],
        ...scene,
      })
    )
  );

const restoreLegacyPair = async (manifest: Manifest) => {
  await completeStateFileRestore(manifest, [], {
    'ds-ct': 'parent-store',
    [leafStateId(3)]: 'artifact-store',
  });
  return listMasks(store().getSegmentationForImage('parent-store')!);
};

const expectTumorMasks = (masks: Array<{ id: string; segmentId: string }>) => {
  expect(masks.map(nameOf)).toEqual(['Tumor 1', 'Tumor 2']);
  expect(markedVoxels(masks[0].id)).toEqual([[1, 1, 1, SEGMENT_VALUE]]);
  expect(markedVoxels(masks[1].id)).toEqual([[3, 3, 3, SEGMENT_VALUE]]);
};

describe('a legacy group restored as bounded masks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('enumerates a current-version artifact no segment binds', async () => {
    await seatLegacyPair();
    const masks = await restoreLegacyPair(
      legacyPairManifest({
        version: MANIFEST_VERSION,
        segmentationArtifacts: [
          {
            id: 'sa-tumor',
            parentImage: 'ds-ct',
            name: 'Tumor',
            dataSourceId: 3,
          },
        ],
      })
    );
    expectTumorMasks(masks);
  });

  it('bounds each decoded segment to the voxels its value covers', async () => {
    const labelmap = await seatLegacyPair();
    expect(labelmap.getPointData().getScalars().getData()).toHaveLength(
      voxelCount(DIMENSIONS)
    );

    const masks = await restoreLegacyPair(
      legacyPairManifest({
        version: '6.4.0',
        segmentGroups: [
          {
            id: 'sg-tumor',
            dataSourceId: 3,
            metadata: { name: 'Tumor', parentImage: 'ds-ct' },
          },
        ],
      })
    );
    expectTumorMasks(masks);
    expect(extentOf(masks[0].id)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(extentOf(masks[1].id)).toEqual([3, 3, 3, 3, 3, 3]);
  });
});
