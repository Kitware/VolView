import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
  boundMasks,
  seatImage,
  store,
  voxelCount,
  type Index3,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { toLabelMap } from '@/src/segmentation/io/import';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import * as resampling from '@/src/io/resample/resample';

// ---------------------------------------------------------------------------
// A parent removed mid-conversion must mint nothing, and the failure must
// reach the user, since neither live call site awaits the conversion.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [4, 4, 4];

/** Two label values, so a completed split would mint two of everything. */
const labelValues = () => {
  const values = new Uint8Array(voxelCount(DIMENSIONS));
  values[5] = 1;
  values[6] = 2;
  return values;
};

/**
 * Resamples held open by hand: `entered` settles once `calls` imports are
 * inside one, `release` lets the nth of them finish. That is the window the
 * parent vanishes in, pinned to the import's own progress rather than to a
 * clock.
 */
function gatedResample(calls = 1) {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const releases: Array<(resampled: vtkImageData) => void> = [];
  vi.spyOn(resampling, 'ensureSameSpace').mockImplementation(
    () =>
      new Promise<vtkImageData>((resolve) => {
        if (releases.push(resolve) === calls) enter();
      })
  );
  const release = (resampled: vtkImageData, call = 0) =>
    releases[call](resampled);
  return { entered, release };
}

async function seatConvertible() {
  const child = await seatImage('child', {
    dimensions: DIMENSIONS,
    values: labelValues(),
  });
  await seatImage('parent', { dimensions: DIMENSIONS });
  return child;
}

const segmentNames = () =>
  useSegmentStore().segments.segmentList.value.map((segment) => segment.name);

const expectNothingMinted = () => {
  expect(Object.keys(store().segmentations)).toEqual([]);
  expect(segmentNames()).toEqual([]);
  expect(boundMasks()).toEqual([]);
};

describe('a labelmap conversion whose parent was removed mid-import', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mints no segmentation, segment or mask, and clears the progress flag', async () => {
    const child = await seatConvertible();
    const resample = gatedResample();

    const conversion = store().convertImageToLabelmap('child', 'parent');
    const outcome = conversion.catch((error: Error) => error);
    await resample.entered;
    expect(store().convertingLabelmaps.has('child')).toBe(true);

    useImageCacheStore().removeImage('parent');
    resample.release(child);

    expect(await outcome).toBeInstanceOf(Error);
    expectNothingMinted();
    expect(store().convertingLabelmaps.has('child')).toBe(false);
  });

  it('refuses a split for a parent that is not in the image cache', async () => {
    const orphaned = await seatImage('gone', {
      dimensions: DIMENSIONS,
      values: labelValues(),
    });
    const labelmap = toLabelMap(orphaned);
    useImageCacheStore().removeImage('gone');

    expect(() =>
      store().splitLabelmapIntoMasks('gone', labelmap, [
        { value: 1, name: 'Liver', color: [1, 2, 3, 255], visible: true },
      ])
    ).toThrow('No such parent image');

    expectNothingMinted();
  });

  it('reports the failure, the way the rest of the import path does', async () => {
    const child = await seatConvertible();
    const resample = gatedResample();

    // What both live call sites start: nobody awaits the conversion itself.
    const conversion = store().startLabelmapConversion('child', 'parent');
    await resample.entered;
    useImageCacheStore().removeImage('parent');
    resample.release(child);
    await conversion;

    expect(useMessageStore().messages.map((message) => message.title)).toEqual([
      'Failed to convert image to a labelmap',
    ]);
    expectNothingMinted();
    expect(store().convertingLabelmaps.has('child')).toBe(false);
  });
});

describe('a labelmap converting onto two parents', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the child converting until its last conversion ends', async () => {
    const child = await seatConvertible();
    await seatImage('other-parent', { dimensions: DIMENSIONS });
    const resample = gatedResample(2);

    const first = store().convertImageToLabelmap('child', 'parent');
    const second = store().convertImageToLabelmap('child', 'other-parent');
    await resample.entered;
    resample.release(child, 0);
    await first;

    expect(store().convertingLabelmaps.has('child')).toBe(true);

    resample.release(child, 1);
    await second;

    expect(store().convertingLabelmaps.has('child')).toBe(false);
  });
});
