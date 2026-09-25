import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { PaintMode } from '@/src/core/tools/paint';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  selectSegment,
  mintSegment,
  lockSegment,
  addActiveSegment,
  boundMasks,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/segmentation/editing/paintProcess';
import { useViewStore } from '@/src/store/views';
import { hostOverSilentWorkers } from '@/src/segmentation/editing/__tests__/silentWorker';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

async function viewImage(id: string) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions([2, 1, 1]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(2),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, id, { id });
  useViewStore().setDataForAllViews(id);
  await nextTick();
  return id;
}

function getScalars(labelMap: vtkLabelMap) {
  return Array.from(labelMap.getPointData().getScalars().getData());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Paint process store', () => {
  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await viewImage('image-1');
  });

  it('opens process controls without changing the paint interaction mode', () => {
    const paintStore = usePaintToolStore();

    paintStore.setMode(PaintMode.Erase);
    paintStore.setProcessControlsOpen(true);

    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Erase);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(true);
  });

  it('uses process interaction mode only while previewing', async () => {
    const paintStore = usePaintToolStore();
    const processStore = usePaintProcessStore();
    const { labelMap } = addActiveSegment();

    paintStore.setMode(PaintMode.Erase);

    expect(paintStore.processControlsOpen).toBe(false);

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([2, 2]),
      extent: target.maskExtent,
    }));

    expect(processStore.processState.step).toBe('previewing');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Process);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(false);
    expect(getScalars(labelMap)).toEqual([2, 2]);

    processStore.confirmProcess();

    expect(processStore.processState.step).toBe('start');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Erase);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(true);
  });

  it('restores the paint interaction mode when preview is canceled', async () => {
    const paintStore = usePaintToolStore();
    const processStore = usePaintProcessStore();
    const { labelMap } = addActiveSegment();

    paintStore.setMode(PaintMode.CirclePaint);
    paintStore.setProcessControlsOpen(true);

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([3, 3]),
      extent: target.maskExtent,
    }));

    expect(getScalars(labelMap)).toEqual([3, 3]);

    processStore.cancelProcess();

    expect(processStore.processState.step).toBe('start');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.activePaintMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.isPaintingModeActive).toBe(true);
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('drops the process worker when a computing run is cancelled', async () => {
    // A job already posted runs to the end, so a cancelled run's work would
    // occupy the worker and the run replacing it would wait behind results
    // nobody wants. Cancelling ends the worker instead.
    const processStore = usePaintProcessStore();
    const { labelMap } = addActiveSegment();
    const { host, workers } = hostOverSilentWorkers();
    host.call((api) => api.smooth(1)).catch(() => undefined);

    const pending = deferred<Uint8Array>();
    const run = processStore.startProcess(async (target) => ({
      scalars: await pending.promise,
      extent: target.maskExtent,
    }));
    expect(processStore.processState.step).toBe('computing');

    processStore.cancelProcess();

    expect(workers[0].terminated).toBe(true);
    // The next run starts on a worker of its own.
    host.call((api) => api.smooth(2)).catch(() => undefined);
    expect(workers).toHaveLength(2);

    pending.resolve(new Uint8Array([4, 4]));
    await run;
    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('ignores stale async results after a newer process starts', async () => {
    const paintStore = usePaintToolStore();
    const { labelMap } = addActiveSegment();

    paintStore.activeMode = PaintMode.Process;
    const processStore = usePaintProcessStore();

    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const firstRun = processStore.startProcess(async (target) => ({
      scalars: await first.promise,
      extent: target.maskExtent,
    }));
    const secondRun = processStore.startProcess(async (target) => ({
      scalars: await second.promise,
      extent: target.maskExtent,
    }));

    first.resolve(new Uint8Array([9, 9]));
    await firstRun;

    expect(processStore.processState.step).toBe('computing');
    expect(getScalars(labelMap)).toEqual([0, 0]);

    second.resolve(new Uint8Array([2, 2]));
    await secondRun;

    expect(processStore.processState.step).toBe('previewing');
    expect(getScalars(labelMap)).toEqual([2, 2]);
  });

  it('hands the algorithm the active segment’s resolved label value', async () => {
    const processStore = usePaintProcessStore();
    const { labelMap } = addActiveSegment(new Uint8Array([0, 0]), 3);
    let target: ProcessTarget | undefined;
    const algorithm = vi.fn(async (resolved: ProcessTarget) => {
      target = resolved;
      return { scalars: new Uint8Array([3, 3]), extent: resolved.maskExtent };
    });

    await processStore.startProcess(algorithm);

    expect(algorithm).toHaveBeenCalledTimes(1);
    expect(target).toMatchObject({ labelValue: SEGMENT_VALUE });
    expect(target!.scalars).not.toBe(
      labelMap.getPointData().getScalars().getData()
    );
  });

  it('refuses to process a locked segment', async () => {
    const processStore = usePaintProcessStore();
    const messageStore = useMessageStore();
    const { maskId, labelMap } = addActiveSegment();
    lockSegment(maskId);

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([2, 2]),
      extent: target.maskExtent,
    }));

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
    expect(
      messageStore.messages.some((message) =>
        message.title.includes('locked segment')
      )
    ).toBe(true);
  });

  it('does not create state for a segment-scoped process on a bare image', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();
    const algorithm = vi.fn();

    await processStore.startProcess(algorithm);

    expect(algorithm).not.toHaveBeenCalled();
    expect(
      segmentationStore.getSegmentationForImage('image-1')
    ).toBeUndefined();
    expect(boundMasks()).toHaveLength(0);
    expect(processStore.processState.step).toBe('start');
    expect(messageStore.messages.map(({ title }) => title)).toContain(
      'No active segment selected'
    );
  });

  it('does not allocate storage for an unbound active segment', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();
    const segmentation =
      segmentationStore.ensureSegmentationForImage('image-1');
    const segment = segmentationStore.createMask(
      segmentation.id,
      mintSegment({
        name: 'Empty',
      })
    );
    selectSegment(segment.id);
    const algorithm = vi.fn();

    await processStore.startProcess(algorithm);

    expect(algorithm).not.toHaveBeenCalled();
    expect(segmentationStore.findMaskBinding(segment.id)).toBeUndefined();
    expect(boundMasks()).toHaveLength(0);
    expect(processStore.processState.step).toBe('start');
    expect(messageStore.messages.map(({ title }) => title)).toContain(
      'No segment content to process'
    );
  });

  it('does not run against an empty bound mask', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();
    const segmentation =
      segmentationStore.ensureSegmentationForImage('image-1');
    const segment = segmentationStore.createMask(
      segmentation.id,
      mintSegment({
        name: 'Empty',
      })
    );
    const voxels = segmentationStore.maskVoxels(segment.id);
    const binding = voxels.materialize();
    selectSegment(segment.id);
    const algorithm = vi.fn();

    await processStore.startProcess(algorithm);

    expect(algorithm).not.toHaveBeenCalled();
    expect(boundMasks().map((mask) => mask.representations.labelmap)).toEqual([
      binding,
    ]);
    expect(processStore.processState.step).toBe('start');
    expect(messageStore.messages.map(({ title }) => title)).toContain(
      'No segment content to process'
    );
  });

  it('does not clone the active segment onto the image being viewed', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { labelMap: firstLabelMap } = addActiveSegment();
    const algorithm = vi.fn(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([4, 4]),
      extent: target.maskExtent,
    }));

    await viewImage('image-2');
    await processStore.startProcess(algorithm);

    expect(algorithm).not.toHaveBeenCalled();
    expect(
      segmentationStore.getSegmentationForImage('image-2')
    ).toBeUndefined();
    expect(getScalars(firstLabelMap)).toEqual([0, 0]);
  });

  it('cancels the preview when the active segment changes', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { segmentationId, labelMap } = addActiveSegment();

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([2, 2]),
      extent: target.maskExtent,
    }));
    expect(processStore.processState.step).toBe('previewing');

    const other = segmentationStore.createMask(
      segmentationId,
      mintSegment({
        name: 'Other',
      })
    );
    selectSegment(other.id);
    await nextTick();

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('does not create a segment for an all-segments process on a bare image', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();

    await processStore.startProcess(
      async (target: ProcessTarget) => ({
        scalars: new Uint8Array([2, 2]),
        extent: target.maskExtent,
      }),
      {
        requiresActiveSegment: false,
      }
    );

    expect(
      segmentationStore.getSegmentationForImage('image-1')
    ).toBeUndefined();
    expect(processStore.processState.step).toBe('start');
    expect(
      messageStore.messages.some(
        (m) => m.title === 'No segmentation to process'
      )
    ).toBe(true);
  });

  it('names the lock rather than reporting nothing to process', async () => {
    const processStore = usePaintProcessStore();
    const messageStore = useMessageStore();
    const { maskId, labelMap } = addActiveSegment(new Uint8Array([1, 1]));
    lockSegment(maskId, true);

    await processStore.startProcess(
      async (target: ProcessTarget) => ({
        scalars: new Uint8Array([2, 2]),
        extent: target.maskExtent,
      }),
      {
        requiresActiveSegment: false,
      }
    );

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([1, 1]);
    const titles = messageStore.messages.map((message) => message.title);
    expect(titles).toContain('Every segment is locked');
    expect(titles).not.toContain('No segmentation to process');
  });

  it('does not claim the lock when an unlocked segment simply holds nothing', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();
    const { segmentationId, maskId } = addActiveSegment(new Uint8Array([1, 1]));
    lockSegment(maskId, true);
    segmentationStore.createMask(
      segmentationId,
      mintSegment({ name: 'Empty' })
    );

    await processStore.startProcess(
      async (target: ProcessTarget) => ({
        scalars: new Uint8Array([2, 2]),
        extent: target.maskExtent,
      }),
      {
        requiresActiveSegment: false,
      }
    );

    const titles = messageStore.messages.map((message) => message.title);
    expect(titles).toContain('No unlocked segment has anything to process');
    expect(titles).not.toContain('Every segment is locked');
  });

  it('does not clone the active segment onto a merely viewed image', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    addActiveSegment();
    await viewImage('image-2');

    await processStore.startProcess(
      async (target: ProcessTarget) => ({
        scalars: new Uint8Array([2, 2]),
        extent: target.maskExtent,
      }),
      {
        requiresActiveSegment: false,
      }
    );

    expect(
      segmentationStore.getSegmentationForImage('image-2')
    ).toBeUndefined();
  });
});
