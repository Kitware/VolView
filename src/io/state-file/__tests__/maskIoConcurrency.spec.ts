import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';

import {
  seatSpecImage as seatImage,
  inMemoryArtifactIO,
  mintSegment,
  manifestForImages,
  serializeToStateFiles,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { MASK_IO_CONCURRENCY } from '@/src/segmentation/io/stateFile';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';

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

/** The in-memory IO, wrapped so each half records its peak calls in flight. */
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
    const segmentIdMap = useSegmentStore().deserialize(parsed);
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
    const segmentIdMap = useSegmentStore().deserialize(parsed);
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
});
