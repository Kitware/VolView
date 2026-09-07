import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  mintSegment,
  segmentOfMask,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import JSZip from 'jszip';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { ManifestSchema, type Manifest } from '@/src/io/state-file/schema';
import { MANIFEST_VERSION } from '@/src/io/state-file/serialize';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';

// ---------------------------------------------------------------------------
// The 7.0.0 wire schema round trip: a scene serializes to `segmentations` +
// `segmentationArtifacts` and restores into fresh stores with the same
// segments, order, active segment and artifact provenance. SegmentMask identity is
// never re-derived from label values, so duplicate names across images survive
// as distinct segments and a segment with no storage survives as one.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const SOURCE = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputLabelmap',
};

async function seatImage(id: string, name: string) {
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

// The real collaborator is itk-wasm image IO, which has no counterpart in the
// node test environment; this local codec keeps the labelmap in memory and
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

/** Everything the round trip must preserve for one parent image. */
const snapshot = (imageId: string) => {
  const store = useSegmentationStore();
  const segments = useSegmentStore().segments;
  const segmentation = store.getSegmentationForImage(imageId)!;
  return {
    name: segmentation.name,
    segments: segmentation.order.map((maskId) => {
      const segment = segmentation.masks[maskId];
      const binding = segment.representations.labelmap;
      const appearance = segments.appearanceOf(segment.segmentId);
      return {
        name: appearance.name,
        color: [...appearance.color],
        visible: appearance.visible,
        locked: appearance.locked,
        binding: binding && {
          labelValue: binding.labelValue,
          extent: [...binding.extent],
          artifactName: store.artifactMeta[binding.artifactId].name,
          artifactSource: store.artifactMeta[binding.artifactId].source,
          artifactParent: store.artifactMeta[binding.artifactId].parentImage,
        },
      };
    }),
  };
};

const selectedTypeSummary = () => {
  const segments = useSegmentStore().segments;
  const segmentId = segments.selectedSegmentId.value;
  if (!segmentId) return undefined;
  const store = useSegmentationStore();
  return {
    // The type is image-independent; this is where it currently has a mask.
    parentImages: Object.values(store.segmentations)
      .filter((segmentation) =>
        Object.values(segmentation.masks).some(
          (segment) => segment.segmentId === segmentId
        )
      )
      .map((segmentation) => segmentation.parentImageId),
    name: segments.appearanceOf(segmentId).name,
  };
};

async function buildScene() {
  await seatImage('img-1', 'CT A');
  await seatImage('img-2', 'CT B');
  const store = useSegmentationStore();

  const first = store.ensureSegmentationForImage('img-1');
  // No binding: a segment created by "add" has no voxels until a first edit.
  const planned = store.createMask(first.id, mintSegment({ name: 'Planned' }));
  useSegmentStore().segments.updateSegment(segmentOfMask(planned.id), {
    locked: true,
    visible: false,
  });
  const tumor = store.createMask(first.id, mintSegment({ name: 'Tumor' }));
  store.ensureLabelmapBinding(tumor.id);
  const artifactId = store.getMask(tumor.id).representations.labelmap!
    .artifactId;
  store.updateArtifactMeta(artifactId, { source: SOURCE });

  // Same name on another image: still a distinct segment.
  const second = store.ensureSegmentationForImage('img-2');
  const otherTumor = store.createMask(
    second.id,
    mintSegment({ name: 'Tumor' })
  );
  store.ensureLabelmapBinding(otherTumor.id);

  useSegmentStore().segments.selectSegment(store.getMask(tumor.id).segmentId);
  await nextTick();
  return { store };
}

describe('segmentation state-file round trip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores segments, order, active segment and artifact provenance', async () => {
    await buildScene();

    const io = makeArtifactIO();
    const zip = new JSZip();
    const manifest = {
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
    } as unknown as Manifest;

    // The registry writes before the records that reference it, as the app's
    // serializer order does.
    useSegmentStore().serialize({ zip, manifest });
    await useSegmentationStore().serialize({ zip, manifest }, io);

    const before = {
      first: snapshot('img-1'),
      second: snapshot('img-2'),
      selected: selectedTypeSummary(),
    };

    // The wire shape is what restore reads back, so parse it first.
    const parsed = ManifestSchema.parse(manifest) as any;
    expect(parsed.segmentations).toHaveLength(2);
    expect(parsed.segmentationArtifacts).toHaveLength(2);
    expect(parsed.segmentGroups).toBeUndefined();

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
    await seatImage('new-1', 'CT A');
    await seatImage('new-2', 'CT B');
    const segmentIdMap = useSegmentStore().deserialize(parsed);
    await useSegmentationStore().deserialize(
      parsed,
      stateFiles,
      { 'img-1': 'new-1', 'img-2': 'new-2' },
      segmentIdMap,
      {},
      io
    );
    await nextTick();

    expect(snapshot('new-1')).toEqual({
      ...before.first,
      segments: before.first.segments.map((segment) => ({
        ...segment,
        binding: segment.binding && {
          ...segment.binding,
          artifactParent: 'new-1',
        },
      })),
    });
    expect(snapshot('new-2')).toEqual({
      ...before.second,
      segments: before.second.segments.map((segment) => ({
        ...segment,
        binding: segment.binding && {
          ...segment.binding,
          artifactParent: 'new-2',
        },
      })),
    });
    expect(selectedTypeSummary()).toEqual({
      parentImages: ['new-1'],
      name: before.selected!.name,
    });
  });

  it('keeps the unbound segment unbound and does not allocate storage for it', async () => {
    await buildScene();

    const io = makeArtifactIO();
    const zip = new JSZip();
    const manifest = {
      version: MANIFEST_VERSION,
      datasets: [{ id: 'img-1', dataSourceId: 1 }],
      dataSources: [{ id: 1, type: 'uri', uri: '/ct-a.nrrd' }],
      datasetFilePath: {},
    } as unknown as Manifest;

    // The registry writes before the records that reference it, as the app's
    // serializer order does.
    useSegmentStore().serialize({ zip, manifest });
    await useSegmentationStore().serialize({ zip, manifest }, io);

    const wire = (manifest as any).segmentations.find(
      (segmentation: any) => segmentation.parentImage === 'img-1'
    );
    const segmentIdByName = Object.fromEntries(
      (manifest as any).segments.map((type: any) => [type.name, type.id])
    );
    const planned = wire.masks.find(
      (segment: any) => segment.segmentId === segmentIdByName.Planned
    );
    expect(planned.representations.labelmap).toBeUndefined();
    // Lock and visibility ride on the type, so the record carries neither.
    const plannedType = (manifest as any).segments.find(
      (segment: any) => segment.id === segmentIdByName.Planned
    );
    expect(plannedType).toMatchObject({ locked: true, visible: false });
    // One artifact per image, not one per segment.
    expect(
      (manifest as any).segmentationArtifacts.filter(
        (artifact: any) => artifact.parentImage === 'img-1'
      )
    ).toHaveLength(1);
  });
});
