import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import {
  deserializeSegmentation,
  type LabelmapIO,
} from '@/src/segmentation/io/stateFile';
import {
  addSegment,
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
// An empty extent, which older files wrote for a label with no voxels, restores
// as a segment without a mask.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];
const GRID = {
  dimensions: DIMENSIONS,
  spacing: [2, 3, 4] as [number, number, number],
  origin: [10, 20, 30] as [number, number, number],
};

const nameOf = (mask: { segmentId: string }) =>
  useSegmentStore().segments.appearanceOf(mask.segmentId).name;

// Every segment, masked or not, so one that should stay without storage shows.
const snapshot = (imageId: string) =>
  useSegmentStore()
    .segments.segmentList(imageId)
    .map(({ id, name }) => {
      const binding = store().maskOf(id);
      return {
        name,
        extent: binding ? [...binding.extent] : undefined,
        dimensions: binding
          ? store().maskVoxels(id).image().getDimensions()
          : undefined,
        marks: markedVoxels(id),
      };
    });

const wireSegmentation = (manifest: any) =>
  manifest.imageSegments.find((entry: any) => entry.imageId === 'img-1');

const wireMask = (manifest: any, name: string) =>
  wireSegmentation(manifest).segments.find(
    (segment: any) => segment.name === name
  );

function pointNodeAtTumorEntry(manifest: any) {
  const segmentation = wireSegmentation(manifest);
  const node = wireMask(manifest, 'Node');
  node.labelmap.path = wireMask(manifest, 'Tumor').labelmap.path;
  return { segmentation, node };
}

const restoredSegment = (name: string, imageId = 'new-1') =>
  useSegmentStore().segments.findSegmentByName(imageId, name)!.id;

// Tumor's mask starts at parent index [1, 1, 1].
const expectTumorOnParentGrid = () => {
  const mask = store().maskVoxels(restoredSegment('Tumor')).image();
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

  const tumor = addSegment('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  seedVoxel(tumor, [2, 1, 1]);
  const node = addSegment('img-1', 'Node');
  seedVoxel(node, [3, 3, 3]);
  addSegment('img-1', 'Unbound');

  const other = addSegment('img-2', 'Tumor');
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
  const result = await deserializeSegmentation({
    manifest: parsed,
    stateFiles: stateFiles,
    dataIDMap: { 'img-1': 'new-1', 'img-2': 'new-2' },
    resolveSegment: useSegmentStore().deserialize(parsed, {
      'img-1': 'new-1',
      'img-2': 'new-2',
    }),
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
    expect(snapshot('new-2')).toEqual(before.second);
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
      deserializeSegmentation({
        manifest: parsed,
        stateFiles: stateFiles,
        dataIDMap: dataIDMap,
        resolveSegment: useSegmentStore().deserialize(parsed, dataIDMap),
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
    const content = saved.imageSegments.map((entry: any) => ({
      parent: entry.imageId,
      masks: entry.segments
        .filter((segment: any) => segment.labelmap)
        .map(({ name, labelmap }: any) => ({
          name,
          extent: labelmap.extent,
          ...snapshotsByPath.get(labelmap.path),
        })),
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
          { name: 'Tumor (2)', ...tumor },
          { name: 'Node (2)', ...node },
        ],
      },
      {
        parent: 'img-2',
        masks: [
          { name: 'Tumor', ...other },
          { name: 'Tumor (2)', ...other },
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
    const mine = addSegment('img-1', 'Mine');
    seedVoxel(mine, [0, 0, 0]);
    const registry = useSegmentStore().segments;
    registry.updateDisplay('img-1', {
      fillOpacity: 0.9,
      outlineThickness: 7,
    });

    await deserializeSegmentation({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'img-1', 'img-2': 'img-2' },
      resolveSegment: useSegmentStore().deserialize(parsed, {
        'img-1': 'img-1',
        'img-2': 'img-2',
      }),
      io: io,
    });
    await nextTick();

    expect(registry.displayOf('img-1').fillOpacity).toBe(0.9);
    expect(registry.displayOf('img-1').outlineThickness).toBe(7);
    expect(store().segmentationName('img-1')).toBe('CT C');
    // The import still landed beside what was there.
    expect(registry.segmentList('img-1').map(({ name }) => name)).toEqual([
      'Mine',
      'Tumor',
      'Node',
      'Unbound',
    ]);
    expect(store().imageMasks('img-1').map(nameOf)).toEqual([
      'Mine',
      'Tumor',
      'Node',
    ]);
    expect(markedVoxels(mine)).toEqual([[0, 0, 0, 1]]);
  });

  it('keeps same-named masks of two images distinct', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO());

    const firstTumor = restoredSegment('Tumor');
    const secondTumor = restoredSegment('Tumor', 'new-2');
    expect(markedVoxels(firstTumor)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(markedVoxels(secondTumor)).toEqual([[0, 0, 0, 1]]);
    expect(store().maskOf(firstTumor)!.image).not.toBe(
      store().maskOf(secondTumor)!.image
    );
    expect(boundMasks()).toHaveLength(3);
  });

  it('leaves a segment that never had storage without any', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO());

    expect(store().maskOf(restoredSegment('Unbound'))).toBeUndefined();
  });

  it('leaves a segment unbound when its entry belongs to another image', async () => {
    await buildScene();

    // A mask sits on its parent's grid, so an entry saved for another image
    // gives this segment storage of a shape its own extent cannot describe.
    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const foreign = manifest.imageSegments.find(
        (entry: any) => entry.imageId === 'img-2'
      );
      const tumor = wireMask(manifest, 'Tumor');
      tumor.labelmap.path = foreign.segments[0].labelmap.path;
    });

    expect(store().maskOf(restoredSegment('Tumor'))).toBeUndefined();
    // The image's other segments restore as they were.
    expect(store().maskOf(restoredSegment('Node'))).toBeDefined();
    expect(markedVoxels(restoredSegment('Node'))).toEqual([
      [3, 3, 3, SEGMENT_VALUE],
    ]);
  });

  it('restores an empty extent as a segment without a mask, unreported', async () => {
    await buildScene();

    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      wireMask(manifest, 'Tumor').labelmap.extent = [0, -1, 0, -1, 0, -1];
    });

    expect(store().maskOf(restoredSegment('Tumor'))).toBeUndefined();
    expect(result.skipped).toEqual([]);
    expect(boundMasks()).toHaveLength(2);
  });

  // Each mask reads its own archive entry into its own buffer, so two masks
  // naming one entry get a copy each and neither aliases the other's voxels.
  it('gives two masks naming one entry storage of their own', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const refs = pointNodeAtTumorEntry(manifest);
      refs.node.labelmap.extent = [1, 2, 1, 1, 1, 1];
    });

    const tumor = restoredSegment('Tumor');
    const node = restoredSegment('Node');
    expect(store().maskVoxels(tumor).image()).not.toBe(
      store().maskVoxels(node).image()
    );
    expect(markedVoxels(tumor)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(markedVoxels(node)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(boundMasks()).toHaveLength(3);
  });

  it('does not let an earlier empty binding erase a later valid binding', async () => {
    await buildScene();

    await roundTrip(inMemoryArtifactIO(), (manifest) => {
      const refs = pointNodeAtTumorEntry(manifest);
      refs.node.labelmap.extent = [0, -1, 0, -1, 0, -1];
      refs.segmentation.segments = [
        refs.node,
        ...refs.segmentation.segments.filter(
          (segment: any) => segment !== refs.node
        ),
      ];
    });

    const tumor = restoredSegment('Tumor');
    expect(store().maskOf(restoredSegment('Node'))).toBeUndefined();
    expect(store().maskVoxels(tumor).image().getDimensions()).toEqual([
      2, 1, 1,
    ]);
    expect(markedVoxels(tumor)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
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
  ])('rejects $title', async ({ extent, reason }) => {
    await buildScene();

    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      wireMask(manifest, 'Tumor').labelmap.extent = extent;
    });

    expect(store().maskOf(restoredSegment('Tumor'))).toBeUndefined();
    expect(result.skipped).toContainEqual({ name: 'Tumor', reason });
    expect(markedVoxels(restoredSegment('Node'))).toEqual([
      [3, 3, 3, SEGMENT_VALUE],
    ]);
    expect(
      Array.from(labelmapScalars(compositeLabelmap('new-1').labelmap)).flatMap(
        (value, index) => (value === 0 ? [] : [[index, value]])
      )
    ).toEqual([[63, 1]]);
    expect(boundMasks()).toHaveLength(2);
  });

  it('keeps a valid binding when another naming the same entry is invalid', async () => {
    await buildScene();

    // Node keeps its own extent, which does not describe Tumor's entry.
    const result = await roundTrip(inMemoryArtifactIO(), (manifest) => {
      pointNodeAtTumorEntry(manifest);
    });

    expect(store().maskOf(restoredSegment('Tumor'))).toBeDefined();
    expect(store().maskOf(restoredSegment('Node'))).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: 'Node',
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
    ).manifest
  );

const restoreLegacyPair = async (manifest: Manifest) => {
  await completeStateFileRestore(manifest, [], {
    'ds-ct': 'parent-store',
    [leafStateId(3)]: 'artifact-store',
  });
  return store().imageMasks('parent-store');
};

const expectTumorMasks = (masks: Array<{ segmentId: string }>) => {
  expect(masks.map(nameOf)).toEqual(['Tumor 1', 'Tumor 2']);
  expect(markedVoxels(masks[0].segmentId)).toEqual([[1, 1, 1, SEGMENT_VALUE]]);
  expect(markedVoxels(masks[1].segmentId)).toEqual([[3, 3, 3, SEGMENT_VALUE]]);
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
    expect(extentOf(masks[0].segmentId)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(extentOf(masks[1].segmentId)).toEqual([3, 3, 3, 3, 3, 3]);
  });
});
