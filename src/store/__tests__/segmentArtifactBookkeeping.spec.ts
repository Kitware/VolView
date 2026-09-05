import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import type { Manifest } from '@/src/io/state-file/schema';
import { useDatasetStore } from '@/src/store/datasets';
import vtkLabelMap from '@/src/vtk/LabelMap';
import {
  addSegment,
  seatImage,
  seedVoxel,
  store,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// A mask belongs to exactly one segment, so `segmentation.order` is the only
// order there is. The invariants: no mask outlives the segment that owns it,
// no mask outlives its parent image, and the state file names every mask,
// each at its own archive path.
// ---------------------------------------------------------------------------

const surface = () => store() as unknown as Record<string, unknown>;

const artifactIds = () => Object.keys(store().artifactMeta);

/** A local codec: itk-wasm image IO has no counterpart in the node test env. */
const makeArtifactIO = () => {
  const labelmaps = new Map<string, vtkLabelMap>();
  return {
    write: async (_format: string, labelmap: vtkLabelMap) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text())! }),
  };
};

async function buildScene() {
  await seatImage('img-1', { name: 'CT A' });
  await seatImage('img-2', { name: 'CT B' });

  const tumor = addSegment('img-1', 'Tumor');
  seedVoxel(tumor, [1, 1, 1]);
  const node = addSegment('img-1', 'Node');
  seedVoxel(node, [2, 2, 2]);
  // Identity with no storage: it owns no mask and names no archive entry.
  const planned = addSegment('img-1', 'Planned');

  const other = addSegment('img-2', 'Tumor');
  seedVoxel(other, [0, 0, 0]);

  return { tumor, node, planned, other };
}

/** One labelled voxel on the 4x4x4 fixture grid, as an import would arrive. */
function importedLabelmap() {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions([4, 4, 4]);
  const values = new Uint8Array(64);
  values[0] = 1;
  labelmap
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  labelmap.computeTransforms();
  return labelmap;
}

const artifactNames = () =>
  Object.values(store().artifactMeta).map((meta) => meta.name);

const split = (name?: string) =>
  store().splitLabelmapIntoSegments(
    'img-1',
    importedLabelmap(),
    [{ value: 1, name: 'Liver', color: [255, 0, 0, 255], visible: true }],
    { artifactName: name }
  );

// A restored artifact's name reaches the saved manifest and the zip entry path,
// so generating one where the manifest carried one renames the file on every
// round trip.
describe('artifact names carried in from a manifest', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { name: 'CT A' });
  });

  it('keeps the name the caller carried', () => {
    split('Liver: left/right*?');

    expect(artifactNames()).toEqual(['Liver: left/right*?']);
  });

  it('generates one when the caller carries none', () => {
    split();

    expect(artifactNames()).toEqual(['Segment Group 1 for CT A']);
  });
});

describe('artifact bookkeeping without the per-parent order map', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('publishes no per-parent artifact order', () => {
    expect(surface().artifactOrderByParent).toBeUndefined();
    expect(surface().artifactsForImage).toBeUndefined();
  });

  it('releases a segment mask with the segment that owns it', async () => {
    const { tumor, node } = await buildScene();
    const tumorArtifact =
      store().getSegment(tumor).representations.labelmap!.artifactId;

    store().deleteSegment(tumor);

    expect(artifactIds()).not.toContain(tumorArtifact);
    expect(store().artifactIndex).not.toHaveProperty(tumorArtifact);
    // The sibling on the same image is untouched.
    expect(artifactIds()).toContain(
      store().getSegment(node).representations.labelmap!.artifactId
    );
  });

  it('releases every mask of an image when its segmentation goes', async () => {
    await buildScene();
    const segmentation = store().getSegmentationForImage('img-1')!;
    const survivor = store().getSegmentationForImage('img-2')!;

    store().removeSegmentation(segmentation.id);

    const remaining = artifactIds();
    expect(remaining).toHaveLength(1);
    expect(store().getSegmentationForArtifact(remaining[0])!.id).toBe(
      survivor.id
    );
  });

  it('releases every mask of an image when the dataset is removed', async () => {
    await buildScene();

    useDatasetStore().remove('img-1');

    expect(
      artifactIds().map(
        (artifactId) => store().artifactMeta[artifactId].parentImage
      )
    ).toEqual(['img-2']);
    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
  });

  it('reaches the outline settings from the artifact a renderer holds', async () => {
    // The renderer is handed an artifact id and nothing else, so the segment
    // model has to be reachable from that id alone.
    const { tumor } = await buildScene();
    const segmentation = store().getSegmentationForImage('img-1')!;
    segmentation.outlineOpacity = 0.25;
    segmentation.outlineThickness = 5;
    const { artifactId } = store().getSegment(tumor).representations.labelmap!;

    expect(store().getSegmentationForArtifact(artifactId)).toMatchObject({
      outlineOpacity: 0.25,
      outlineThickness: 5,
    });
  });

  it('serializes one archive entry per mask, at a path of its own', async () => {
    await buildScene();
    const manifest = {} as Manifest;

    await store().serialize({ zip: new JSZip(), manifest }, makeArtifactIO());

    const artifacts = manifest.segmentationArtifacts!;
    // Three segments hold storage; the unmaterialized one names no entry.
    expect(artifacts).toHaveLength(3);
    expect(new Set(artifacts.map((artifact) => artifact.path))).toHaveProperty(
      'size',
      3
    );
    expect(artifacts.map((artifact) => artifact.parentImage).sort()).toEqual([
      'img-1',
      'img-1',
      'img-2',
    ]);
    // Every binding the manifest carries points at an artifact it also carries.
    const named = new Set(artifacts.map((artifact) => artifact.id));
    manifest.segmentations!.forEach((segmentation) =>
      segmentation.segments.forEach((segment) => {
        const binding = segment.representations.labelmap;
        if (binding) expect(named).toContain(binding.artifactId);
      })
    );
  });
});
