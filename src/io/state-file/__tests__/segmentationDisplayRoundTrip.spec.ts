import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';

// ---------------------------------------------------------------------------
// Display state on the wire: additive with zod defaults, so a 7.0.0 manifest
// still loads and comes back with the identity values.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

// itk-wasm has no node counterpart; this keeps the labelmap in memory and
// hands the archive a token that reads back to it.
const makeArtifactIO = () => {
  const labelmaps = new Map<string, any>();
  return {
    write: async (_format: string, labelmap: any) => {
      const token = `labelmap-${labelmaps.size}`;
      labelmaps.set(token, labelmap);
      return token;
    },
    read: async (file: File) => ({ image: labelmaps.get(await file.text()) }),
  };
};

const baseManifest = () =>
  ({
    version: MANIFEST_VERSION,
    datasets: [{ id: 'img-1', dataSourceId: 1 }],
    dataSources: [{ id: 1, type: 'uri', uri: '/ct.nrrd' }],
    datasetFilePath: {},
  }) as unknown as Manifest;

/** A scene whose display state is nowhere near the defaults. */
function buildScene() {
  const segmentation = store().ensureSegmentationForImage('img-1');
  const tumor = store().createSegment(segmentation.id, { name: 'Tumor' });
  store().ensureLabelmapBinding(tumor.id);
  const planned = store().createSegment(segmentation.id, { name: 'Planned' });

  store().updateSegment(tumor.id, {
    fillOpacity: 0.25,
    outlineOpacity: 0.75,
  });
  store().updateSegment(planned.id, { fillOpacity: 0 });

  const model = store().segmentations[segmentation.id];
  model.fillOpacity = 0.5;
  model.outlineOpacity = 0.125;
  model.outlineThickness = 5;
}

// A 7.0.0 manifest: same shape, no display fields anywhere.
const manifest700 = () => ({
  version: '7.0.0',
  dataSources: [],
  segmentations: [
    {
      id: 'seg-1',
      name: 'CT',
      parentImage: 'img-1',
      segments: [
        {
          id: 's-1',
          name: 'Tumor',
          color: [255, 0, 0, 255],
          visible: true,
          locked: false,
          representations: {},
        },
      ],
      order: ['s-1'],
    },
  ],
});

describe('segmentation display state on the wire', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('serializes per-segment and per-segmentation display state', async () => {
    buildScene();

    const manifest = baseManifest();
    await store().serialize({ zip: new JSZip(), manifest }, makeArtifactIO());

    const wire = ManifestSchema.parse(manifest).segmentations![0];
    expect(wire.fillOpacity).toBe(0.5);
    expect(wire.outlineOpacity).toBe(0.125);
    expect(wire.outlineThickness).toBe(5);
    expect(wire.segments.map((segment) => segment.fillOpacity)).toEqual([
      0.25, 0,
    ]);
    expect(wire.segments.map((segment) => segment.outlineOpacity)).toEqual([
      0.75, 1,
    ]);
  });

  it('restores display state through a save and load', async () => {
    buildScene();

    const zip = new JSZip();
    const manifest = baseManifest();
    const io = makeArtifactIO();
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

    setActivePinia(createPinia());
    await seatImage('new-1');
    await store().deserialize(parsed, stateFiles, { 'img-1': 'new-1' }, {}, io);
    await nextTick();

    const restored = store().getSegmentationForImage('new-1')!;
    expect(restored.fillOpacity).toBe(0.5);
    expect(restored.outlineOpacity).toBe(0.125);
    expect(restored.outlineThickness).toBe(5);
    expect(
      restored.order.map((id) => restored.segments[id].fillOpacity)
    ).toEqual([0.25, 0]);
    expect(
      restored.order.map((id) => restored.segments[id].outlineOpacity)
    ).toEqual([0.75, 1]);
  });

  it('fills defaults for a 7.0.0 manifest that carries no display state', () => {
    const parsed = ManifestSchema.parse(manifest700());
    const wire = parsed.segmentations![0];

    expect(wire.fillOpacity).toBe(1);
    expect(wire.outlineOpacity).toBe(1);
    expect(wire.outlineThickness).toBe(2);
    expect(wire.segments[0].fillOpacity).toBe(1);
    expect(wire.segments[0].outlineOpacity).toBe(1);
  });

  it('restores a 7.0.0 manifest with default display state', async () => {
    const parsed = ManifestSchema.parse(manifest700());

    await store().deserialize(
      parsed,
      [],
      { 'img-1': 'img-1' },
      {},
      makeArtifactIO()
    );
    await nextTick();

    const restored = store().getSegmentationForImage('img-1')!;
    expect(restored.fillOpacity).toBe(1);
    expect(restored.outlineOpacity).toBe(1);
    expect(restored.outlineThickness).toBe(2);
    const segment = restored.segments[restored.order[0]];
    expect(segment.fillOpacity).toBe(1);
    expect(segment.outlineOpacity).toBe(1);
  });
});
