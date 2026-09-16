import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import JSZip from 'jszip';

import {
  seatSpecImage,
  addMask,
  inMemoryArtifactIO,
  markedVoxels,
  bindEmptyMasks,
  stateFilesOf,
  manifestForImages,
  seedVoxel,
  deleteSegmentOf,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { MASK_IO_CONCURRENCY } from '@/src/segmentation/io/stateFile';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
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
  await seatSpecImage('img-1', 'CT A');
  bindEmptyMasks(
    'img-1',
    Array.from({ length: MASK_COUNT }, (_, index) => `Segment ${index}`)
  );
  await nextTick();
};

const seedMasks = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const maskId = addMask('img-1', `Segment ${index}`);
    seedVoxel(maskId, [0, 0, 0]);
    return maskId;
  });

// Holding a full batch leaves the next mask editable until its write starts.
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
      if (described.length === MASK_IO_CONCURRENCY) queued.resolve();
      if (described.length <= MASK_IO_CONCURRENCY) await released.promise;
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
    expect(io.peak.write).toBe(MASK_IO_CONCURRENCY);

    setActivePinia(createPinia());
    await seatSpecImage('new-1', 'CT A');
    const { segmentIdMap } = useSegmentStore().deserialize(parsed);
    const result = await store().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap,
      io,
    });
    await nextTick();

    expect(io.peak.read).toBe(MASK_IO_CONCURRENCY);
    expect(result.skipped).toEqual([]);
    expect(store().getSegmentationForImage('new-1')!.order).toHaveLength(
      MASK_COUNT
    );
  });

  it('keeps the masks in wire order', async () => {
    await buildScene();

    const io = inMemoryArtifactIO();
    const { parsed, stateFiles } = await serializeToStateFiles(
      manifestForImages(['img-1']),
      io
    );
    const wire = parsed.segmentations[0];
    wire.order.reverse();
    const names = wire.order.map((id: string) => {
      const mask = wire.masks.find((entry: any) => entry.id === id);
      return parsed.segments.find(
        (segment: any) => segment.id === mask.segmentId
      ).name;
    });
    const completed: number[] = [];
    const unorderedIO = {
      ...io,
      read: async (file: File) => {
        const index = Number((await file.text()).split('-')[1]);
        for (let pending = index + 1; pending > 0; pending -= 1) {
          await Promise.resolve();
        }
        const result = await io.read(file);
        completed.push(index);
        return result;
      },
    };

    setActivePinia(createPinia());
    await seatSpecImage('new-1', 'CT A');
    const { segmentIdMap } = useSegmentStore().deserialize(parsed);
    await store().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap,
      io: unorderedIO,
    });
    await nextTick();

    expect(completed.map((index) => `Segment ${index}`)).not.toEqual(names);
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
    await seatSpecImage('img-1', 'CT A');
    const grown = seedMasks(MASK_IO_CONCURRENCY + 1)[MASK_IO_CONCURRENCY];

    const save = startGatedSave();
    await save.queued;
    seedVoxel(grown, [3, 0, 0]);
    await save.finish();

    const parsed = ManifestSchema.parse(save.manifest) as any;
    const stateFiles = await stateFilesOf(save.zip, parsed);

    setActivePinia(createPinia());
    await seatSpecImage('new-1', 'CT A');
    const result = await store().deserialize({
      manifest: parsed,
      stateFiles,
      dataIDMap: { 'img-1': 'new-1' },
      segmentIdMap: useSegmentStore().deserialize(parsed).segmentIdMap,
      io: save.io,
    });
    await nextTick();

    expect(result.skipped).toEqual([]);
    const restored = store().imageMasks('new-1')[MASK_IO_CONCURRENCY];
    expect([...restored.representations.labelmap!.extent]).toEqual([
      0, 3, 0, 0, 0, 0,
    ]);
    expect(markedVoxels(restored.id)).toEqual([
      [0, 0, 0, SEGMENT_VALUE],
      [3, 0, 0, SEGMENT_VALUE],
    ]);
  });

  it('writes a mask whose segment is deleted while queued as the manifest describes it', async () => {
    await seatSpecImage('img-1', 'CT A');
    const deleted = seedMasks(MASK_IO_CONCURRENCY + 1)[MASK_IO_CONCURRENCY];

    const save = startGatedSave();
    await save.queued;
    deleteSegmentOf(deleted);
    await save.finish();

    expect(save.described[MASK_IO_CONCURRENCY].map(({ name }) => name)).toEqual(
      [`Segment ${MASK_IO_CONCURRENCY}`]
    );
  });
});
