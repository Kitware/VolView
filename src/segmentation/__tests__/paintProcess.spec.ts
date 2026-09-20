import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { PaintMode } from '@/src/core/tools/paint';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import {
  viewImage,
  type Index3,
  activateAppPinia,
  selectSegment,
  mintSegment,
  lockSegment,
  addActiveSegment,
  addMask,
  boundMasks,
  markedVoxels,
  seedVoxel,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/segmentation/editing/paintProcess';
import { hostOverSilentWorkers } from '@/src/segmentation/editing/__tests__/silentWorker';
import { defer } from '@/src/utils';

const TWO_VOXELS = { dimensions: [2, 1, 1] as Index3 };

function getScalars(labelMap: vtkLabelMap) {
  return Array.from(labelMap.getPointData().getScalars().getData());
}

describe('Paint process store', () => {
  beforeEach(async () => {
    activateAppPinia();
    await viewImage('image-1', TWO_VOXELS);
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
      scalars: new Uint8Array([1, 1]),
      extent: target.maskExtent,
    }));

    expect(processStore.processState.step).toBe('previewing');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.Process);
    expect(paintStore.activePaintMode).toBe(PaintMode.Erase);
    expect(paintStore.isPaintingModeActive).toBe(false);
    expect(getScalars(labelMap)).toEqual([1, 1]);

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
      scalars: new Uint8Array([1, 1]),
      extent: target.maskExtent,
    }));

    expect(getScalars(labelMap)).toEqual([1, 1]);

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

    const pending = defer<Uint8Array>();
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

    pending.resolve(new Uint8Array([1, 1]));
    await run;
    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('ignores stale async results after a newer process starts', async () => {
    const paintStore = usePaintToolStore();
    const { labelMap } = addActiveSegment();

    paintStore.activeMode = PaintMode.Process;
    const processStore = usePaintProcessStore();

    const first = defer<Uint8Array>();
    const second = defer<Uint8Array>();
    const firstRun = processStore.startProcess(async (target) => ({
      scalars: await first.promise,
      extent: target.maskExtent,
    }));
    const secondRun = processStore.startProcess(async (target) => ({
      scalars: await second.promise,
      extent: target.maskExtent,
    }));

    first.resolve(new Uint8Array([1, 1]));
    await firstRun;

    expect(processStore.processState.step).toBe('computing');
    expect(getScalars(labelMap)).toEqual([0, 0]);

    second.resolve(new Uint8Array([0, 1]));
    await secondRun;

    expect(processStore.processState.step).toBe('previewing');
    expect(getScalars(labelMap)).toEqual([0, 1]);
  });

  it('says why a run cannot start without starting one', () => {
    const processStore = usePaintProcessStore();

    expect(processStore.startRefusal('image-1')).toBe('No segments to process');
    expect(processStore.startRefusal('image-1', false)).toBe(
      'No segmentation to process'
    );

    const { maskId } = addActiveSegment(new Uint8Array([1, 0]));
    expect(processStore.startRefusal('image-1')).toBe('');
    expect(processStore.startRefusal('image-1', false)).toBe('');

    lockSegment(maskId);
    expect(processStore.startRefusal('image-1')).toBe(
      'Cannot process locked segment'
    );
    expect(processStore.startRefusal('image-1', false)).toBe(
      'Every segment is locked'
    );
  });

  it('processes the first segment while none has been chosen', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { id } = segmentationStore.ensureSegmentationForImage('image-1');
    const first = segmentationStore.createMask(id, mintSegment({ name: 'A' }));
    segmentationStore.createMask(id, mintSegment({ name: 'B' }));
    const voxels = segmentationStore.maskVoxels(first.id);
    voxels.materialize();
    voxels.ensureContains([0, 1, 0, 0, 0, 0]);
    voxels.apply(new Uint8Array([1, 0]));

    expect(processStore.startRefusal('image-1')).toBe('');

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([1, 1]),
      extent: target.maskExtent,
    }));

    expect(getScalars(voxels.image())).toEqual([1, 1]);
  });

  it('names a selected segment with no mask on this image as empty', () => {
    // The selection is shared across images while masks are per image, so a
    // selected segment routinely has no record on the image being viewed.
    const segmentId = mintSegment({ name: 'Elsewhere' });
    useSegmentStore().segments.selectSegment(segmentId);

    expect(usePaintProcessStore().startRefusal('image-1')).toBe(
      'No segment content to process'
    );
  });

  it('refuses to process a locked segment', async () => {
    const processStore = usePaintProcessStore();
    const messageStore = useMessageStore();
    const { maskId, labelMap } = addActiveSegment();
    lockSegment(maskId);

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([1, 1]),
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

  it.each([
    ['a segment-scoped', true],
    ['an all-segments', false],
  ])(
    'creates no state for %s process on a bare image',
    async (_scope, requiresActiveSegment) => {
      const processStore = usePaintProcessStore();
      const algorithm = vi.fn();

      await processStore.startProcess(algorithm, { requiresActiveSegment });

      expect(algorithm).not.toHaveBeenCalled();
      expect(
        useSegmentationStore().getSegmentationForImage('image-1')
      ).toBeUndefined();
      expect(boundMasks()).toHaveLength(0);
      expect(processStore.processState.step).toBe('start');
    }
  );

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

  it.each([
    ['a segment-scoped', true],
    ['an all-segments', false],
  ])(
    'does not clone the active segment onto a viewed image for %s process',
    async (_scope, requiresActiveSegment) => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment();
      const algorithm = vi.fn();

      await viewImage('image-2', TWO_VOXELS);
      await processStore.startProcess(algorithm, { requiresActiveSegment });

      expect(algorithm).not.toHaveBeenCalled();
      expect(
        useSegmentationStore().getSegmentationForImage('image-2')
      ).toBeUndefined();
      expect(getScalars(labelMap)).toEqual([0, 0]);
    }
  );

  it('cancels the preview when the active segment changes', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { segmentationId, labelMap } = addActiveSegment();

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([1, 1]),
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

  it('names the lock rather than reporting nothing to process', async () => {
    const processStore = usePaintProcessStore();
    const messageStore = useMessageStore();
    const { maskId, labelMap } = addActiveSegment(new Uint8Array([1, 1]));
    lockSegment(maskId, true);

    await processStore.startProcess(
      async (target: ProcessTarget) => ({
        scalars: new Uint8Array([0, 0]),
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
        scalars: new Uint8Array([0, 0]),
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

  const emptyingProcess = async (target: ProcessTarget) => ({
    scalars: new Uint8Array(target.scalars.length),
    extent: target.maskExtent,
  });

  it('deletes a mask the applied result leaves empty once it is applied', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { maskId } = addActiveSegment(new Uint8Array([1, 1]));

    await processStore.startProcess(emptyingProcess);
    const whilePreviewing = segmentationStore.maskExists(maskId);
    // Applied from the original view, so the result is written back first.
    processStore.setShowingOriginal(true);
    processStore.confirmProcess();

    expect(whilePreviewing).toBe(true);
    expect(segmentationStore.maskExists(maskId)).toBe(false);
  });

  it('keeps the mask of an emptying preview that is cancelled', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { maskId, labelMap } = addActiveSegment(new Uint8Array([1, 1]));

    await processStore.startProcess(emptyingProcess);
    processStore.cancelProcess();

    expect(segmentationStore.maskExists(maskId)).toBe(true);
    expect(getScalars(labelMap)).toEqual([1, 1]);
  });

  it('deletes only the masks an applied run leaves empty', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const emptied = addMask('image-1', 'Emptied');
    const kept = addMask('image-1', 'Kept');
    seedVoxel(emptied, [0, 0, 0]);
    seedVoxel(kept, [0, 0, 0]);
    seedVoxel(kept, [1, 0, 0]);

    await processStore.startProcess(
      async (target: ProcessTarget) =>
        target.maskId === emptied
          ? emptyingProcess(target)
          : { scalars: new Uint8Array([0, 1]), extent: target.maskExtent },
      { requiresActiveSegment: false }
    );
    processStore.confirmProcess();

    expect(segmentationStore.maskExists(emptied)).toBe(false);
    // The run ends before the deletion, which would otherwise roll this back.
    expect(markedVoxels(kept)).toEqual([[1, 0, 0, SEGMENT_VALUE]]);
  });
});
