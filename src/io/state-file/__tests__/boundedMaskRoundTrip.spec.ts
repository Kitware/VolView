import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { isEmptyExtent, listSegments } from '@/src/types/segmentation';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import {
  addSegment,
  extentOf,
  markedVoxels,
  parentImage,
  seatImage,
  seedVoxel,
  store,
  voxelCount,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// The state file carries N bounded masks. What goes into the archive is each
// segment's own mask at its own size, and what the binding's `extent` says is
// where that mask sits in the parent image. Restoring puts every segment back
// on the same parent voxels, which is the only thing a state file has to
// promise: the mask's dimensions are storage, its extent is meaning.
//
// A materialized mask that covers nothing is a real state now, not a migration
// placeholder, so an empty extent restores as an empty mask.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];
const GRID = {
  dimensions: DIMENSIONS,
  spacing: [2, 3, 4] as [number, number, number],
  origin: [10, 20, 30] as [number, number, number],
};

// The real collaborator is itk-wasm image IO, which has no counterpart in the
// node test environment; this local codec keeps the labelmap in memory and
// hands the archive a token that reads back to it.
const makeArtifactIO = () => {
  const labelmaps = new Map<string, vtkLabelMap>();
  const written: vtkLabelMap[] = [];
  return {
    written,
    write: async (_format: string, labelmap: vtkLabelMap) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      written.push(labelmap);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text())! }),
  };
};

/** Everything about a segment's voxels the round trip has to preserve. */
const snapshot = (imageId: string) =>
  listSegments(store().getSegmentationForImage(imageId)!).map((segment) => ({
    name: segment.name,
    extent: segment.representations.labelmap
      ? [...segment.representations.labelmap.extent]
      : undefined,
    dimensions: segment.representations.labelmap
      ? store().segmentVoxels(segment.id).image().getDimensions()
      : undefined,
    marks: markedVoxels(segment.id),
  }));

async function buildScene() {
  await seatImage('img-1', { ...GRID, name: 'CT A' });
  await seatImage('img-2', { ...GRID, name: 'CT B' });

  const tumor = addSegment('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  seedVoxel(tumor, [2, 1, 1]);
  const node = addSegment('img-1', 'Node');
  seedVoxel(node, [3, 3, 3]);
  // Materialized and never drawn on: storage exists and covers nothing.
  const planned = addSegment('img-1', 'Planned');
  store().segmentVoxels(planned).materialize();
  // No storage at all.
  addSegment('img-1', 'Unbound');

  const other = addSegment('img-2', 'Tumor');
  seedVoxel(other, [0, 0, 0]);
  await nextTick();
}

const emptyManifest = () =>
  ({
    version: MANIFEST_VERSION,
    datasets: [
      { id: 'img-1', dataSourceId: 1 },
      { id: 'img-2', dataSourceId: 2 },
    ],
    dataSources: [
      { id: 1, type: 'uri', uri: '/ct-a.nrrd' },
      { id: 2, type: 'uri', uri: '/ct-b.nrrd' },
    ],
    datasetFilePath: {},
  }) as unknown as Manifest;

async function roundTrip(
  io: ReturnType<typeof makeArtifactIO>,
  tamper?: (manifest: any) => void
) {
  const zip = new JSZip();
  const manifest = emptyManifest();
  await store().serialize({ zip, manifest }, io);

  const parsed = ManifestSchema.parse(manifest) as any;
  tamper?.(parsed);
  const stateFiles = await Promise.all(
    parsed.segmentationArtifacts.map(async (artifact: any) => ({
      archivePath: artifact.path,
      file: new File(
        [await zip.file(artifact.path)!.async('string')],
        'artifact.vti'
      ),
    }))
  );

  setActivePinia(createPinia());
  await seatImage('new-1', { ...GRID, name: 'CT A' });
  await seatImage('new-2', { ...GRID, name: 'CT B' });
  await store().deserialize(
    parsed,
    stateFiles,
    { 'img-1': 'new-1', 'img-2': 'new-2' },
    {},
    io
  );
  await nextTick();
}

describe('bounded masks through the state file', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('writes each mask at its own size, not the parent image’s', async () => {
    await buildScene();
    const io = makeArtifactIO();

    await store().serialize(
      { zip: new JSZip(), manifest: emptyManifest() },
      io
    );

    const sizes = io.written.map((labelmap) => labelmap.getDimensions());
    expect(sizes).toContainEqual([2, 1, 1]);
    expect(sizes).toContainEqual([1, 1, 1]);
    expect(sizes).not.toContainEqual([...DIMENSIONS]);
    expect(
      io.written.every(
        (labelmap) =>
          (labelmap.getPointData().getScalars().getData() as ArrayLike<number>)
            .length < voxelCount(DIMENSIONS)
      )
    ).toBe(true);
  });

  it('restores every segment onto the parent voxels it had', async () => {
    await buildScene();
    const before = {
      first: snapshot('img-1'),
      second: snapshot('img-2'),
    };

    await roundTrip(makeArtifactIO());

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

  it('restores a mask that covers nothing as one that covers nothing', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const planned = listSegments(
      store().getSegmentationForImage('new-1')!
    ).find((segment) => segment.name === 'Planned')!;
    expect(planned.representations.labelmap).toBeDefined();
    expect(isEmptyExtent(extentOf(planned.id)!)).toBe(true);
    expect(store().segmentVoxels(planned.id).scalars()).toHaveLength(0);
  });

  it('leaves a segment that never had storage without any', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const unbound = listSegments(
      store().getSegmentationForImage('new-1')!
    ).find((segment) => segment.name === 'Unbound')!;
    expect(unbound.representations.labelmap).toBeUndefined();
  });

  it('leaves a segment unbound when its artifact belongs to another image', async () => {
    await buildScene();

    // A mask sits on its parent's grid, so a binding across images would put
    // the segment on storage of another shape.
    await roundTrip(makeArtifactIO(), (manifest) => {
      const foreign = manifest.segmentationArtifacts.find(
        (artifact: any) => artifact.parentImage === 'img-2'
      );
      const segmentation = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-1'
      );
      const tumor = segmentation.segments.find(
        (segment: any) => segment.name === 'Tumor'
      );
      tumor.representations.labelmap.artifactId = foreign.id;
    });

    const restored = listSegments(store().getSegmentationForImage('new-1')!);
    const named = (name: string) =>
      restored.find((segment) => segment.name === name)!;
    expect(named('Tumor').representations.labelmap).toBeUndefined();
    // The image's other segments restore as they were.
    expect(named('Node').representations.labelmap).toBeDefined();
    expect(markedVoxels(named('Node').id)).toEqual([[3, 3, 3, 2]]);
  });

  it('puts the restored masks back on the parent grid', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const tumor = listSegments(store().getSegmentationForImage('new-1')!).find(
      (segment) => segment.name === 'Tumor'
    )!;
    const mask = store().segmentVoxels(tumor.id).image();
    expect(Array.from(mask.indexToWorld([0, 0, 0] as never))).toEqual(
      Array.from(parentImage('new-1').indexToWorld([1, 1, 1] as never))
    );
    expect(Array.from(mask.getSpacing())).toEqual(
      Array.from(parentImage('new-1').getSpacing())
    );
  });
});

// A pre-7.0.0 group: one labelmap file, no segment descriptors. Restore decodes
// its voxel values into segments, and each of those gets its own bounded mask
// like any other import.
describe('a legacy group restored as bounded masks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('bounds each decoded segment to the voxels its value covers', async () => {
    await seatImage('parent-store', { ...GRID, name: 'CT Chest' });
    const values = new Uint8Array(voxelCount(DIMENSIONS));
    values[1 + 1 * 4 + 1 * 16] = 1;
    values[3 + 3 * 4 + 3 * 16] = 2;
    const labelmap = await seatImage('artifact-store', {
      ...GRID,
      name: 'Tumor.seg.nrrd',
      values,
    });
    expect(labelmap.getPointData().getScalars().getData()).toHaveLength(
      voxelCount(DIMENSIONS)
    );

    const manifest = ManifestSchema.parse(
      migrateManifest(
        JSON.stringify({
          version: '6.4.0',
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
          segmentGroups: [
            {
              id: 'sg-tumor',
              dataSourceId: 3,
              metadata: { name: 'Tumor', parentImage: 'ds-ct' },
            },
          ],
        })
      )
    );

    await completeStateFileRestore(manifest, [], {
      'ds-ct': 'parent-store',
      [leafStateId(3)]: 'artifact-store',
    });

    const segments = listSegments(
      store().getSegmentationForImage('parent-store')!
    );
    expect(segments.map((segment) => segment.name)).toEqual([
      'Tumor 1',
      'Tumor 2',
    ]);
    expect(extentOf(segments[0].id)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(extentOf(segments[1].id)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(markedVoxels(segments[0].id)).toEqual([[1, 1, 1, 1]]);
    expect(markedVoxels(segments[1].id)).toEqual([[3, 3, 3, 2]]);
  });
});
