import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage as seatImage,
  inMemoryArtifactIO,
  mintSegment,
  manifestForImages,
  serializeToStateFiles,
} from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/types/segmentation';

// ---------------------------------------------------------------------------
// Display state on the wire: the per-image multipliers ride on the
// segmentation, the per-segment opacities on the type, and a manifest that
// states neither comes back with the app defaults.
// ---------------------------------------------------------------------------

const store = () => useSegmentationStore();

const baseManifest = () => manifestForImages(['img-1']);

/** A scene whose display state is nowhere near the defaults. */
function buildScene() {
  const segmentation = store().ensureSegmentationForImage('img-1');
  const segments = useSegmentStore().segments;
  const tumorType = mintSegment({
    name: 'Tumor',
    fillOpacity: 0.25,
    outlineOpacity: 0.75,
  });
  const tumor = store().createMask(segmentation.id, tumorType);
  store().ensureLabelmapBinding(tumor.id);
  const plannedType = mintSegment({ name: 'Planned', fillOpacity: 0 });
  store().createMask(segmentation.id, plannedType);

  const model = store().segmentations[segmentation.id];
  model.fillOpacity = 0.5;
  model.outlineOpacity = 0.125;
  model.outlineThickness = 5;
  return { segments, tumorType, plannedType };
}

const opacitiesOf = (segmentIds: string[]) => {
  const segments = useSegmentStore().segments;
  return {
    fill: segmentIds.map((id) => segments.appearanceOf(id).fillOpacity),
    outline: segmentIds.map((id) => segments.appearanceOf(id).outlineOpacity),
  };
};

// A 7.0.0 manifest that states no display state anywhere.
const manifest700 = () => ({
  version: '7.0.0',
  dataSources: [],
  segments: [{ id: 't-1', name: 'Tumor', color: [255, 0, 0, 255] }],
  segmentations: [
    {
      id: 'seg-1',
      name: 'CT',
      parentImage: 'img-1',
      masks: [{ id: 's-1', segmentId: 't-1', representations: {} }],
      order: ['s-1'],
    },
  ],
});

describe('segmentation display state on the wire', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  it('serializes the per-image multipliers and the per-type opacities', async () => {
    buildScene();

    const zip = new JSZip();
    const manifest = baseManifest();
    useSegmentStore().serialize({ zip, manifest });
    await store().serialize({ zip, manifest }, inMemoryArtifactIO());

    const parsed = ManifestSchema.parse(manifest);
    const wire = parsed.segmentations![0];
    expect(wire.fillOpacity).toBe(0.5);
    expect(wire.outlineOpacity).toBe(0.125);
    expect(wire.outlineThickness).toBe(5);
    const segmentById = new Map(
      parsed.segments!.map((segment) => [segment.id, segment])
    );
    expect(
      wire.masks.map(
        (segment) => segmentById.get(segment.segmentId)!.fillOpacity
      )
    ).toEqual([0.25, 0]);
    expect(
      wire.masks.map(
        (segment) => segmentById.get(segment.segmentId)!.outlineOpacity
      )
    ).toEqual([0.75, undefined]);
  });

  it('restores display state through a save and load', async () => {
    buildScene();

    const io = inMemoryArtifactIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      baseManifest(),
      io
    );

    setActivePinia(createPinia());
    await seatImage('new-1');
    await store().deserialize({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap: useSegmentStore().deserialize(parsed),
      io: io,
    });
    await nextTick();

    const restored = store().getSegmentationForImage('new-1')!;
    expect(restored.fillOpacity).toBe(0.5);
    expect(restored.outlineOpacity).toBe(0.125);
    expect(restored.outlineThickness).toBe(5);
    const opacities = opacitiesOf(
      restored.order.map((id) => restored.masks[id].segmentId)
    );
    expect(opacities.fill).toEqual([0.25, 0]);
    expect(opacities.outline).toEqual([0.75, 1]);
  });

  it('fills defaults for a manifest that carries no display state', () => {
    const parsed = ManifestSchema.parse(manifest700());
    const wire = parsed.segmentations![0];

    expect(wire.fillOpacity).toBe(DEFAULT_SEGMENTATION_FILL_OPACITY);
    expect(wire.outlineOpacity).toBe(1);
    expect(wire.outlineThickness).toBe(2);
    // Absent on a segment means the app default, supplied by the resolver.
    expect(parsed.segments![0].fillOpacity).toBeUndefined();
    expect(parsed.segments![0].outlineOpacity).toBeUndefined();
  });

  it('restores a 7.0.0 manifest with default display state', async () => {
    const parsed = ManifestSchema.parse(manifest700());

    await store().deserialize({
      manifest: parsed,
      stateFiles: [],
      dataIDMap: { 'img-1': 'img-1' },
      segmentIdMap: useSegmentStore().deserialize(parsed),
      io: inMemoryArtifactIO(),
    });
    await nextTick();

    const restored = store().getSegmentationForImage('img-1')!;
    expect(restored.fillOpacity).toBe(DEFAULT_SEGMENTATION_FILL_OPACITY);
    expect(restored.outlineOpacity).toBe(1);
    expect(restored.outlineThickness).toBe(2);
    const segment = restored.masks[restored.order[0]];
    const opacities = opacitiesOf([segment.segmentId]);
    expect(opacities.fill).toEqual([1]);
    expect(opacities.outline).toEqual([1]);
  });
});
