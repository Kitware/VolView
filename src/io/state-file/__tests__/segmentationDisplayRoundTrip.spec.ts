import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  seatSpecImage,
  inMemoryArtifactIO,
  manifestForImages,
  serializeToStateFiles,
  seedVoxel,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { deserializeSegmentation } from '@/src/segmentation/io/stateFile';
import { nextTick } from 'vue';

import { ManifestSchema } from '@/src/io/state-file/schema';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useSegmentStore } from '@/src/segmentation/segments';
import { DEFAULT_SEGMENTATION_DISPLAY } from '@/src/segmentation/model';

// ---------------------------------------------------------------------------
// Display state on the wire: the per-image multipliers ride on the
// image's segment set, the opacities on each segment, and a manifest that
// states neither comes back with the app defaults.
// ---------------------------------------------------------------------------

const baseManifest = () => manifestForImages(['img-1']);

/** A scene whose display state is nowhere near the defaults. */
function buildScene() {
  const segments = useSegmentStore().segments;
  const tumor = segments.mintSegment('img-1', {
    name: 'Tumor',
    fillOpacity: 0.25,
    outlineOpacity: 0.75,
  });
  seedVoxel(tumor, [0, 0, 0]);
  const planned = segments.mintSegment('img-1', {
    name: 'Planned',
    fillOpacity: 0,
  });
  seedVoxel(planned, [1, 0, 0]);
  segments.updateDisplay('img-1', {
    fillOpacity: 0.5,
    outlineOpacity: 0.125,
    outlineThickness: 5,
  });
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
  dataSources: [{ id: 1, type: 'uri', uri: '/img-1.nrrd' }],
  datasets: [{ id: 'img-1', dataSourceId: 1 }],
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
    await seatSpecImage('img-1');
  });

  it('serializes the per-image multipliers and the per-segment opacities', async () => {
    buildScene();

    const { parsed: saved } = await serializeToStateFiles(
      baseManifest(),
      inMemoryArtifactIO()
    );
    const parsed = ManifestSchema.parse(saved);
    const [entry] = parsed.imageSegments!;
    expect(entry.display).toEqual({
      fillOpacity: 0.5,
      outlineOpacity: 0.125,
      outlineThickness: 5,
    });
    const masked = entry.segments.filter(({ labelmap }) => labelmap);
    expect(masked.map(({ fillOpacity }) => fillOpacity)).toEqual([0.25, 0]);
    expect(masked.map(({ outlineOpacity }) => outlineOpacity)).toEqual([
      0.75,
      undefined,
    ]);
  });

  it('restores display state through a save and load', async () => {
    buildScene();

    const io = inMemoryArtifactIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      baseManifest(),
      io
    );

    setActivePinia(createPinia());
    await seatSpecImage('new-1');
    await deserializeSegmentation({
      manifest: parsed,
      stateFiles: stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      resolveSegment: useSegmentStore().deserialize(parsed, {
        'img-1': 'new-1',
      }),
      io: io,
    });
    await nextTick();

    expect(useSegmentStore().segments.displayOf('new-1')).toEqual({
      fillOpacity: 0.5,
      outlineOpacity: 0.125,
      outlineThickness: 5,
    });
    const opacities = opacitiesOf(
      store()
        .imageMasks('new-1')
        .map(({ segmentId }) => segmentId)
    );
    expect(opacities.fill).toEqual([0.25, 0]);
    expect(opacities.outline).toEqual([0.75, 1]);
  });

  it('fills defaults for a manifest that carries no display state', () => {
    const parsed = ManifestSchema.parse(
      migrateManifest(JSON.stringify(manifest700())).manifest
    );
    const [entry] = parsed.imageSegments!;
    expect(entry).toMatchObject({
      imageId: 'img-1',
      display: DEFAULT_SEGMENTATION_DISPLAY,
    });
    // Absent on a segment means the app default, supplied by the resolver.
    expect(entry.segments[0].fillOpacity).toBeUndefined();
    expect(entry.segments[0].outlineOpacity).toBeUndefined();
  });

  it('restores a 7.0.0 manifest with default display state', async () => {
    const parsed = ManifestSchema.parse(
      migrateManifest(JSON.stringify(manifest700())).manifest
    );

    const resolveSegment = useSegmentStore().deserialize(parsed, {
      'img-1': 'img-1',
    });
    await deserializeSegmentation({
      manifest: parsed,
      stateFiles: [],
      dataIDMap: { 'img-1': 'img-1' },
      resolveSegment,
      io: inMemoryArtifactIO(),
    });
    await nextTick();

    expect(useSegmentStore().segments.displayOf('img-1')).toEqual(
      DEFAULT_SEGMENTATION_DISPLAY
    );
    const tumor = resolveSegment('img-1', 't-1')!;
    // A wire mask with no labelmap restores no mask.
    expect(store().maskOf(tumor)).toBeUndefined();
    const opacities = opacitiesOf([tumor]);
    expect(opacities.fill).toEqual([1]);
    expect(opacities.outline).toEqual([1]);
  });
});
