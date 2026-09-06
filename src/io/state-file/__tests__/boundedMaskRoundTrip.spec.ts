import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import { leafStateId } from '@/src/io/import/dataSource';
import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { isEmptyExtent, listSegments } from '@/src/types/segmentation';
import vtkLabelMap from '@/src/vtk/LabelMap';
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

/** The name the record shows, which lives on the type it references. */
const nameOf = (segment: { typeId: string }) =>
  useSegmentTypeStore().types.appearanceOf(segment.typeId).name;

/** Everything about a segment's voxels the round trip has to preserve. */
const snapshot = (imageId: string) =>
  listSegments(store().getSegmentationForImage(imageId)!).map((segment) => ({
    name: nameOf(segment),
    extent: segment.representations.labelmap
      ? [...segment.representations.labelmap.extent]
      : undefined,
    dimensions: segment.representations.labelmap
      ? store().segmentVoxels(segment.id).image().getDimensions()
      : undefined,
    marks: markedVoxels(segment.id),
  }));

const wireSegmentation = (manifest: any) =>
  manifest.segmentations.find((entry: any) => entry.parentImage === 'img-1');

const wireTypeId = (manifest: any, name: string) =>
  manifest.segmentTypes.find((type: any) => type.name === name)?.id;

const wireSegment = (manifest: any, name: string) =>
  wireSegmentation(manifest).segments.find(
    (segment: any) => segment.typeId === wireTypeId(manifest, name)
  );

function wireArtifactFor(manifest: any, segment: any) {
  const id = segment.representations.labelmap.artifactId;
  const artifact = manifest.segmentationArtifacts.find(
    (candidate: any) => candidate.id === id
  );
  return { id, name: artifact.name };
}

function pointNodeAtTumorArtifact(manifest: any) {
  const segmentation = wireSegmentation(manifest);
  const tumor = wireSegment(manifest, 'Tumor');
  const node = wireSegment(manifest, 'Node');
  const tumorArtifact = wireArtifactFor(manifest, tumor);
  const nodeArtifactId = node.representations.labelmap.artifactId;
  node.representations.labelmap.artifactId = tumorArtifact.id;
  return { segmentation, tumor, node, tumorArtifact, nodeArtifactId };
}

const restoredSegment = (name: string) =>
  listSegments(store().getSegmentationForImage('new-1')!).find(
    (segment) => nameOf(segment) === name
  )!;

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
  useSegmentTypeStore().serialize({ zip, manifest });
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
  const result = await store().deserialize(
    parsed,
    stateFiles,
    { 'img-1': 'new-1', 'img-2': 'new-2' },
    useSegmentTypeStore().deserialize(parsed),
    {},
    io
  );
  await nextTick();
  return result;
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

  it('remaps label values when restored over a parent that already has segments', async () => {
    await buildScene();
    // Reading a file yields fresh bytes each time; the in-memory codec has to
    // copy to say the same, or both restores would share one mask.
    const shared = makeArtifactIO();
    const io = {
      ...shared,
      read: async (file: File) => {
        const { image } = await shared.read(file);
        const copy = vtkLabelMap.newInstance(
          image.get('spacing', 'origin', 'direction')
        );
        copy.setDimensions(image.getDimensions());
        copy.getPointData().setScalars(
          vtkDataArray.newInstance({
            numberOfComponents: 1,
            values: new Uint8Array(
              image.getPointData().getScalars().getData() as Uint8Array
            ),
          })
        );
        copy.computeTransforms();
        return { image: copy };
      },
    };
    const zip = new JSZip();
    const manifest = emptyManifest();
    useSegmentTypeStore().serialize({ zip, manifest });
    await store().serialize({ zip, manifest }, io);
    const parsed = ManifestSchema.parse(manifest) as any;
    const stateFiles = await Promise.all(
      parsed.segmentationArtifacts.map(async (artifact: any) => ({
        archivePath: artifact.path,
        file: new File(
          [await zip.file(artifact.path)!.async('string')],
          'artifact.vti'
        ),
      }))
    );
    const dataIDMap = { 'img-1': 'img-1', 'img-2': 'img-2' };

    setActivePinia(createPinia());
    await seatImage('img-1', { ...GRID, name: 'CT A' });
    await seatImage('img-2', { ...GRID, name: 'CT B' });
    // Each import adopts the incoming registry afresh, so the second pass
    // brings its own types rather than landing on the first pass's records.
    const restore = () =>
      store().deserialize(
        parsed,
        stateFiles,
        dataIDMap,
        useSegmentTypeStore().deserialize(parsed),
        {},
        io
      );
    await restore();
    await restore();
    await nextTick();

    const bound = listSegments(store().getSegmentationForImage('img-1')!)
      .filter((segment) => segment.representations.labelmap)
      .map((segment) => ({
        labelValue: segment.representations.labelmap!.labelValue,
        marks: markedVoxels(segment.id) ?? [],
      }));
    expect(bound).toHaveLength(6);
    expect(new Set(bound.map(({ labelValue }) => labelValue)).size).toBe(6);
    bound.forEach(({ labelValue, marks }) =>
      marks.forEach((mark) => expect(mark[3]).toBe(labelValue))
    );
  });

  it('leaves an existing image display alone when a scene is imported onto it', async () => {
    await buildScene();
    const io = makeArtifactIO();
    const zip = new JSZip();
    const manifest = emptyManifest();
    useSegmentTypeStore().serialize({ zip, manifest });
    await store().serialize({ zip, manifest }, io);
    const parsed = ManifestSchema.parse(manifest) as any;
    const stateFiles = await Promise.all(
      parsed.segmentationArtifacts.map(async (artifact: any) => ({
        archivePath: artifact.path,
        file: new File(
          [await zip.file(artifact.path)!.async('string')],
          'artifact.vti'
        ),
      }))
    );

    // The scene the user is in already has masks and a display of its own.
    setActivePinia(createPinia());
    await seatImage('img-1', { ...GRID, name: 'CT A' });
    await seatImage('img-2', { ...GRID, name: 'CT B' });
    const mine = addSegment('img-1', 'Mine');
    seedVoxel(mine, [0, 0, 0]);
    const segmentation = store().getSegmentationForImage('img-1')!;
    store().updateSegmentationDisplay(segmentation.id, {
      fillOpacity: 0.9,
      outlineThickness: 7,
    });

    await store().deserialize(
      parsed,
      stateFiles,
      { 'img-1': 'img-1', 'img-2': 'img-2' },
      useSegmentTypeStore().deserialize(parsed),
      {},
      io
    );
    await nextTick();

    expect(segmentation.fillOpacity).toBe(0.9);
    expect(segmentation.outlineThickness).toBe(7);
    expect(segmentation.name).toBe('CT A');
    // The import still landed beside what was there.
    expect(segmentation.order.length).toBeGreaterThan(1);
    expect(markedVoxels(mine)).toEqual([[0, 0, 0, 1]]);
  });

  it('keeps bindings distinct when wire segmentation and segment ids repeat', async () => {
    await buildScene();

    let firstWireArtifactId = '';
    let secondWireArtifactId = '';
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      const first = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-1'
      );
      const second = manifest.segmentations.find(
        (entry: any) => entry.parentImage === 'img-2'
      );
      const tumorTypeIds = manifest.segmentTypes
        .filter((type: any) => type.name === 'Tumor')
        .map((type: any) => type.id);
      const findTumor = (segmentation: any) =>
        segmentation.segments.find((segment: any) =>
          tumorTypeIds.includes(segment.typeId)
        );
      const firstTumor = findTumor(first);
      const secondTumor = findTumor(second);
      firstWireArtifactId = firstTumor.representations.labelmap.artifactId;
      secondWireArtifactId = secondTumor.representations.labelmap.artifactId;

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

    const firstTumor = listSegments(
      store().getSegmentationForImage('new-1')!
    ).find((segment) => nameOf(segment) === 'Tumor')!;
    const secondTumor = listSegments(
      store().getSegmentationForImage('new-2')!
    ).find((segment) => nameOf(segment) === 'Tumor')!;
    expect(firstTumor.representations.labelmap?.artifactId).toBe(
      result.artifactIdMap[firstWireArtifactId]
    );
    expect(secondTumor.representations.labelmap?.artifactId).toBe(
      result.artifactIdMap[secondWireArtifactId]
    );
    expect(markedVoxels(firstTumor.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(markedVoxels(secondTumor.id)).toEqual([[0, 0, 0, 1]]);
    expect(result.artifactIdMap[firstWireArtifactId]).toBeDefined();
    expect(result.artifactIdMap[secondWireArtifactId]).toBeDefined();
    expect(Object.keys(store().artifactMeta)).toHaveLength(4);
  });

  it('restores a mask that covers nothing as one that covers nothing', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const planned = listSegments(
      store().getSegmentationForImage('new-1')!
    ).find((segment) => nameOf(segment) === 'Planned')!;
    expect(planned.representations.labelmap).toBeDefined();
    expect(isEmptyExtent(extentOf(planned.id)!)).toBe(true);
    expect(store().segmentVoxels(planned.id).scalars()).toHaveLength(0);
  });

  it('leaves a segment that never had storage without any', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const unbound = listSegments(
      store().getSegmentationForImage('new-1')!
    ).find((segment) => nameOf(segment) === 'Unbound')!;
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
        (segment: any) => segment.typeId === wireTypeId(manifest, 'Tumor')
      );
      tumor.representations.labelmap.artifactId = foreign.id;
    });

    const restored = listSegments(store().getSegmentationForImage('new-1')!);
    const named = (name: string) =>
      restored.find((segment) => nameOf(segment) === name)!;
    expect(named('Tumor').representations.labelmap).toBeUndefined();
    // The image's other segments restore as they were.
    expect(named('Node').representations.labelmap).toBeDefined();
    expect(markedVoxels(named('Node').id)).toEqual([[3, 3, 3, 2]]);
  });

  it('rejects an empty extent that points at foreground mask data', async () => {
    await buildScene();

    let artifact: ReturnType<typeof wireArtifactFor>;
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      const tumor = wireSegment(manifest, 'Tumor');
      artifact = wireArtifactFor(manifest, tumor);
      tumor.representations.labelmap.extent = [0, -1, 0, -1, 0, -1];
    });

    const tumor = restoredSegment('Tumor');
    expect(tumor.representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: artifact!.name,
      reason: 'empty extent references a mask with foreground voxels',
    });
    expect(result.artifactIdMap[artifact!.id]).toBeUndefined();
    expect(Object.keys(store().artifactMeta)).toHaveLength(3);
  });

  it('rejects every same-sized binding that gives one artifact different locations', async () => {
    await buildScene();

    let refs: ReturnType<typeof pointNodeAtTumorArtifact>;
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      refs = pointNodeAtTumorArtifact(manifest);
      refs.node.representations.labelmap.extent = [0, 1, 0, 0, 0, 0];
    });

    const restored = listSegments(store().getSegmentationForImage('new-1')!);
    expect(
      restored.find((segment) => nameOf(segment) === 'Tumor')!.representations
        .labelmap
    ).toBeUndefined();
    expect(
      restored.find((segment) => nameOf(segment) === 'Node')!.representations
        .labelmap
    ).toBeUndefined();
    expect(
      result.skipped.filter(
        ({ name, reason }) =>
          name === refs!.tumorArtifact.name &&
          reason === 'bindings disagree on the artifact extent'
      )
    ).toHaveLength(2);
    expect(result.artifactIdMap[refs!.tumorArtifact.id]).toBeUndefined();
    expect(result.artifactIdMap[refs!.nodeArtifactId]).toBeUndefined();
    expect(Object.keys(store().artifactMeta)).toHaveLength(2);
  });

  it('does not let an earlier empty binding erase a later valid binding', async () => {
    await buildScene();

    let refs: ReturnType<typeof pointNodeAtTumorArtifact>;
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      refs = pointNodeAtTumorArtifact(manifest);
      refs.node.representations.labelmap.extent = [0, -1, 0, -1, 0, -1];
      refs.segmentation.order = [
        refs.node.id,
        ...refs.segmentation.order.filter((id: string) => id !== refs.node.id),
      ];
    });

    const tumor = restoredSegment('Tumor');
    const node = restoredSegment('Node');
    expect(node.representations.labelmap).toBeUndefined();
    expect(tumor.representations.labelmap?.artifactId).toBe(
      result.artifactIdMap[refs!.tumorArtifact.id]
    );
    expect(store().segmentVoxels(tumor.id).image().getDimensions()).toEqual([
      2, 1, 1,
    ]);
    expect(markedVoxels(tumor.id)).toEqual([
      [1, 1, 1, 1],
      [2, 1, 1, 1],
    ]);
    expect(result.skipped).toContainEqual({
      name: refs!.tumorArtifact.name,
      reason: 'empty extent references a mask with foreground voxels',
    });
    expect(result.artifactIdMap[refs!.nodeArtifactId]).toBeUndefined();
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
  ])('rejects $title', async ({ extent, reason }) => {
    await buildScene();

    let artifact: ReturnType<typeof wireArtifactFor>;
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      const tumor = wireSegment(manifest, 'Tumor');
      artifact = wireArtifactFor(manifest, tumor);
      tumor.representations.labelmap.extent = extent;
    });

    expect(restoredSegment('Tumor').representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({ name: artifact!.name, reason });
    expect(result.artifactIdMap[artifact!.id]).toBeUndefined();
    expect(Object.keys(store().artifactMeta)).toHaveLength(3);
  });

  it('refuses a wire label value that would turn background into a segment', async () => {
    await buildScene();

    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      wireSegment(manifest, 'Tumor').representations.labelmap.labelValue = 0;
    });

    expect(restoredSegment('Tumor').representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: 'Tumor',
      reason: 'invalid label value',
    });
    expect(markedVoxels(restoredSegment('Node').id)).toHaveLength(1);
  });

  it('keeps a valid binding when another reference to its artifact is invalid', async () => {
    await buildScene();

    let refs: ReturnType<typeof pointNodeAtTumorArtifact>;
    const result = await roundTrip(makeArtifactIO(), (manifest) => {
      refs = pointNodeAtTumorArtifact(manifest);
    });

    const tumor = restoredSegment('Tumor');
    const node = restoredSegment('Node');
    const tumorArtifactId = result.artifactIdMap[refs!.tumorArtifact.id];
    expect(tumor.representations.labelmap?.artifactId).toBe(tumorArtifactId);
    expect(node.representations.labelmap).toBeUndefined();
    expect(result.skipped).toContainEqual({
      name: refs!.tumorArtifact.name,
      reason: 'extent does not match the loaded mask dimensions',
    });
    expect(store().artifactMeta[tumorArtifactId]).toBeDefined();
    expect(result.artifactIdMap[refs!.nodeArtifactId]).toBeUndefined();
  });

  it('puts the restored masks back on the parent grid', async () => {
    await buildScene();

    await roundTrip(makeArtifactIO());

    const tumor = listSegments(store().getSegmentationForImage('new-1')!).find(
      (segment) => nameOf(segment) === 'Tumor'
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

  it('enumerates a current-version artifact no segment binds', async () => {
    await seatImage('parent-store', { ...GRID, name: 'CT Chest' });
    const values = new Uint8Array(voxelCount(DIMENSIONS));
    values[1 + 1 * 4 + 1 * 16] = 1;
    values[3 + 3 * 4 + 3 * 16] = 2;
    await seatImage('artifact-store', {
      ...GRID,
      name: 'Tumor.seg.nrrd',
      values,
    });

    const manifest = ManifestSchema.parse(
      migrateManifest(
        JSON.stringify({
          version: MANIFEST_VERSION,
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
          segmentationArtifacts: [
            {
              id: 'sa-tumor',
              parentImage: 'ds-ct',
              name: 'Tumor',
              dataSourceId: 3,
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
    expect(segments.map(nameOf)).toEqual(['Tumor 1', 'Tumor 2']);
    expect(markedVoxels(segments[0].id)).toEqual([[1, 1, 1, 1]]);
    expect(markedVoxels(segments[1].id)).toEqual([[3, 3, 3, 2]]);
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
    expect(segments.map(nameOf)).toEqual(['Tumor 1', 'Tumor 2']);
    expect(extentOf(segments[0].id)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(extentOf(segments[1].id)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(markedVoxels(segments[0].id)).toEqual([[1, 1, 1, 1]]);
    expect(markedVoxels(segments[1].id)).toEqual([[3, 3, 3, 2]]);
  });
});
