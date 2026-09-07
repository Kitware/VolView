import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  inMemoryArtifactIO,
  mintSegment,
  segmentOfMask,
  manifestForImages,
  serializeToStateFiles,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';

// ---------------------------------------------------------------------------
// The 7.0.0 wire schema round trip: a scene serializes to `segmentations` +
// `segmentationArtifacts` and restores into fresh stores with the same
// segments, order, active segment and artifact provenance. SegmentMask identity is
// never re-derived from label values, so duplicate names across images survive
// as distinct segments and a segment with no storage survives as one.
// ---------------------------------------------------------------------------

const SOURCE = {
  providerId: 'analysis-provider',
  jobId: 'job-abc',
  outputId: 'outputLabelmap',
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

    const io = inMemoryArtifactIO();
    const before = {
      first: snapshot('img-1'),
      second: snapshot('img-2'),
      selected: selectedTypeSummary(),
    };
    const { parsed, stateFiles } = await serializeToStateFiles(
      manifestForImages(['img-1', 'img-2']),
      io
    );
    expect(parsed.segmentations).toHaveLength(2);
    expect(parsed.segmentationArtifacts).toHaveLength(2);
    expect(parsed.segmentGroups).toBeUndefined();

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

    const io = inMemoryArtifactIO();
    const zip = new JSZip();
    const manifest = manifestForImages(['img-1']);

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
