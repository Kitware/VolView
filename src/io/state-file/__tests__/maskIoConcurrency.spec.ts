import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import {
  seatSpecImage as seatImage,
  addMask,
  inMemoryArtifactIO,
  markedVoxels,
  mintSegment,
  manifestForImages,
  seedVoxel,
  deleteSegmentOf,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { MASK_IO_CONCURRENCY } from '@/src/segmentation/io/stateFile';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { ManifestSchema } from '@/src/io/state-file/schema';
import { defer } from '@/src/utils';
import type vtkLabelMap from '@/src/vtk/LabelMap';
import type { LabelmapSegment } from '@/src/segmentation/model';

// ---------------------------------------------------------------------------
// Every mask is a codec call of its own, and every codec call is a worker of
// its own, so save and restore bound how many they run at a time. These count
// the calls in flight around an in-memory IO that settles a few microtasks
// late, which is enough for an unbounded fan-out to overlap completely.
// ---------------------------------------------------------------------------

const MASK_COUNT = 12;
// The cap itself, not a copy of it: a spec that restated the number would keep
// passing for a save and restore that stopped bounding anything.
const LIMIT = MASK_IO_CONCURRENCY;

/** Resolves after enough microtasks for every already-started call to start. */
const settleLate = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const countingIO = () => {
  const inner = inMemoryArtifactIO();
  const peak = { write: 0, read: 0 };
  const inFlight = { write: 0, read: 0 };
  const around = <A extends unknown[], R>(
    half: 'write' | 'read',
    call: (...args: A) => Promise<R>
  ) => {
    return async (...args: A) => {
      inFlight[half] += 1;
      peak[half] = Math.max(peak[half], inFlight[half]);
      try {
        await settleLate();
        return await call(...args);
      } finally {
        inFlight[half] -= 1;
      }
    };
  };
  return {
    peak,
    write: around('write', inner.write),
    read: around('read', inner.read),
  };
};

const buildScene = async () => {
  await seatImage('img-1', 'CT A');
  const segmentation = store().ensureSegmentationForImage('img-1');
  for (let index = 0; index < MASK_COUNT; index += 1) {
    const mask = store().createMask(
      segmentation.id,
      mintSegment({ name: `Segment ${index}` })
    );
    store().ensureLabelmapBinding(mask.id);
  }
  await nextTick();
};

const seedMasks = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const maskId = addMask('img-1', `Segment ${index}`);
    seedVoxel(maskId, [0, 0, 0]);
    return maskId;
  });

/**
 * Saves img-1 with the first LIMIT writes held open, which is exactly what
 * leaves the mask past the cap unwritten and editable until finish().
 */
const startGatedSave = () => {
  const io = inMemoryArtifactIO();
  const queued = defer<void>();
  const released = defer<void>();
  const described: LabelmapSegment[][] = [];
  const gatedIO = {
    read: io.read,
    write: async (
      format: string,
      labelmap: vtkLabelMap,
      segments: LabelmapSegment[]
    ) => {
      described.push(segments);
      const written = io.write(format, labelmap);
      if (described.length === LIMIT) queued.resolve();
      if (described.length <= LIMIT) await released.promise;
      return written;
    },
  };
  const zip = new JSZip();
  const manifest = manifestForImages(['img-1']);
  useSegmentStore().serialize({ zip, manifest });
  const saving = store().serialize({ zip, manifest }, gatedIO);
  return {
    io,
    zip,
    manifest,
    described,
    queued: queued.promise,
    finish: async () => {
      released.resolve();
      await saving;
    },
  };
};

describe('mask io concurrency', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('writes and reads every mask, a bounded number at a time', async () => {
    await buildScene();

    const io = countingIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      manifestForImages(['img-1']),
      io
    );
    const wire = parsed.segmentations[0];
    expect(wire.masks).toHaveLength(MASK_COUNT);
    expect(io.peak.write).toBe(LIMIT);

    setActivePinia(createPinia());
    await seatImage('new-1', 'CT A');
    const { segmentIdMap } = useSegmentStore().deserialize(parsed);
    const result = await useSegmentationStore().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap,
      io,
    });
    await nextTick();

    expect(io.peak.read).toBe(LIMIT);
    expect(result.skipped).toEqual([]);
    expect(store().getSegmentationForImage('new-1')!.order).toHaveLength(
      MASK_COUNT
    );
  });

  it('keeps the masks in wire order', async () => {
    await buildScene();

    const io = countingIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      manifestForImages(['img-1']),
      io
    );
    const names = parsed.segments.map((segment: any) => segment.name);

    setActivePinia(createPinia());
    await seatImage('new-1', 'CT A');
    const { segmentIdMap } = useSegmentStore().deserialize(parsed);
    await useSegmentationStore().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap,
      io,
    });
    await nextTick();

    const segments = useSegmentStore().segments;
    const segmentation = store().getSegmentationForImage('new-1')!;
    expect(
      segmentation.order.map(
        (maskId) =>
          segments.appearanceOf(segmentation.masks[maskId].segmentId).name
      )
    ).toEqual(names);
  });

  // Editing stays available while a save runs, and a mask past the cap is
  // written long after the manifest was assembled: what the file says about
  // the last one has to describe the voxels its write was handed.
  it('restores a mask grown while the writes ahead of it were queued', async () => {
    await seatImage('img-1', 'CT A');
    const grown = seedMasks(LIMIT + 1)[LIMIT];

    const save = startGatedSave();
    await save.queued;
    seedVoxel(grown, [3, 0, 0]);
    await save.finish();

    const parsed = ManifestSchema.parse(save.manifest) as any;
    const stateFiles = await Promise.all(
      parsed.segmentations[0].masks.map(async (mask: any) => {
        const { path } = mask.representations.labelmap;
        return {
          archivePath: path,
          file: new File(
            [await save.zip.file(path)!.async('string')],
            'mask.vti'
          ),
        };
      })
    );

    setActivePinia(createPinia());
    await seatImage('new-1', 'CT A');
    const result = await useSegmentationStore().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
      io: save.io,
    });
    await nextTick();

    expect(result.skipped).toEqual([]);
    const restored = store().imageMasks('new-1')[LIMIT];
    expect([...restored.representations.labelmap!.extent]).toEqual([
      0, 3, 0, 0, 0, 0,
    ]);
    expect(markedVoxels(restored.id)).toEqual([
      [0, 0, 0, SEGMENT_VALUE],
      [3, 0, 0, SEGMENT_VALUE],
    ]);
  });

  it('writes a mask whose segment is deleted while queued as the manifest describes it', async () => {
    await seatImage('img-1', 'CT A');
    const deleted = seedMasks(LIMIT + 1)[LIMIT];

    const save = startGatedSave();
    await save.queued;
    deleteSegmentOf(deleted);
    await save.finish();

    expect(save.described[LIMIT].map(({ name }) => name)).toEqual([
      `Segment ${LIMIT}`,
    ]);
  });
});
