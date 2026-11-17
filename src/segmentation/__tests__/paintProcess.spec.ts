import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { PaintMode } from '@/src/core/tools/paint';
import { messageTitles } from '@/src/components/__tests__/messageDisplay';
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
  addSegment,
  boundMasks,
  markedVoxels,
  makeLabelmap,
  savedLabelmaps,
  serializeAnnotations,
  serializeToStateFiles,
  inMemoryArtifactIO,
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
import { useLabelmapImportStore } from '@/src/segmentation/io/labelmapImport';

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

    const { segmentId } = addActiveSegment(new Uint8Array([1, 0]));
    expect(processStore.startRefusal('image-1')).toBe('');
    expect(processStore.startRefusal('image-1', false)).toBe('');

    lockSegment(segmentId);
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
    const first = mintSegment('image-1', { name: 'A' });
    mintSegment('image-1', { name: 'B' });
    const voxels = segmentationStore.maskVoxels(first);
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
    // A segment selected on this image need not have a mask yet.
    const segmentId = mintSegment('image-1', { name: 'Unpainted' });
    useSegmentStore().segments.selectSegment(segmentId);

    expect(usePaintProcessStore().startRefusal('image-1')).toBe(
      'No segment content to process'
    );
  });

  it('refuses to process a locked segment', async () => {
    const processStore = usePaintProcessStore();
    const { segmentId, labelMap } = addActiveSegment();
    lockSegment(segmentId);

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([1, 1]),
      extent: target.maskExtent,
    }));

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
    expect(
      messageTitles().some((title) => title.includes('locked segment'))
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
      expect(useSegmentStore().segments.segmentList('image-1')).toEqual([]);
      expect(boundMasks()).toHaveLength(0);
      expect(processStore.processState.step).toBe('start');
    }
  );

  it('does not allocate storage for an unbound active segment', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const segmentId = mintSegment('image-1', { name: 'Empty' });
    selectSegment(segmentId);
    const algorithm = vi.fn();

    await processStore.startProcess(algorithm);

    expect(algorithm).not.toHaveBeenCalled();
    expect(segmentationStore.maskOf(segmentId)).toBeUndefined();
    expect(boundMasks()).toHaveLength(0);
    expect(processStore.processState.step).toBe('start');
    expect(messageTitles()).toContain('No segment content to process');
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
      expect(useSegmentationStore().imageMasks('image-2')).toEqual([]);
      expect(getScalars(labelMap)).toEqual([0, 0]);
    }
  );

  it('cancels the preview when the active segment changes', async () => {
    const processStore = usePaintProcessStore();
    const { labelMap } = addActiveSegment();

    await processStore.startProcess(async (target: ProcessTarget) => ({
      scalars: new Uint8Array([1, 1]),
      extent: target.maskExtent,
    }));
    expect(processStore.processState.step).toBe('previewing');

    selectSegment(mintSegment('image-1', { name: 'Other' }));
    await nextTick();

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('names the lock rather than reporting nothing to process', async () => {
    const processStore = usePaintProcessStore();
    const { segmentId, labelMap } = addActiveSegment(new Uint8Array([1, 1]));
    lockSegment(segmentId, true);

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
    const titles = messageTitles();
    expect(titles).toContain('Every segment is locked');
    expect(titles).not.toContain('No segmentation to process');
  });

  const emptyingProcess = async (target: ProcessTarget) => ({
    scalars: new Uint8Array(target.scalars.length),
    extent: target.maskExtent,
  });

  it('keeps imported definitions and selection after a process removes their last mask', async () => {
    const segments = useSegmentStore();
    segments.segments.applyConfig({ Lung: {} });
    segments.segments.addSegment('image-1', { name: 'Unrelated' });
    await viewImage('image-2', TWO_VOXELS);
    const conversionStore = useLabelmapImportStore();
    conversionStore.splitLabelmapIntoMasks(
      'image-2',
      makeLabelmap({ ...TWO_VOXELS, values: new Uint8Array([1, 1]) }),
      [{ value: 1, name: 'Unrelated', color: [255, 0, 0, 255], visible: true }]
    );
    segments.segments.selectSegment(
      segments.segments.findSegmentByName('image-2', 'Unrelated')?.id
    );
    const saved = serializeAnnotations();
    const processStore = usePaintProcessStore();

    await processStore.startProcess(emptyingProcess);
    processStore.confirmProcess();

    expect(serializeAnnotations()).toEqual(saved);
    const { parsed } = await serializeToStateFiles(
      serializeAnnotations(),
      inMemoryArtifactIO()
    );
    expect(savedLabelmaps(parsed)).toEqual([]);
  });

  it('deletes a mask the applied result leaves empty once it is applied', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { segmentId } = addActiveSegment(new Uint8Array([1, 1]));

    await processStore.startProcess(emptyingProcess);
    const whilePreviewing = !!segmentationStore.maskOf(segmentId);
    // Applied from the original view, so the result is written back first.
    processStore.setShowingOriginal(true);
    processStore.confirmProcess();

    expect(whilePreviewing).toBe(true);
    expect(!!segmentationStore.maskOf(segmentId)).toBe(false);
  });

  it('keeps the mask of an emptying preview that is cancelled', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { segmentId, labelMap } = addActiveSegment(new Uint8Array([1, 1]));

    await processStore.startProcess(emptyingProcess);
    processStore.cancelProcess();

    expect(!!segmentationStore.maskOf(segmentId)).toBe(true);
    expect(getScalars(labelMap)).toEqual([1, 1]);
  });

  it('deletes only the masks an applied run leaves empty', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const emptied = addSegment('image-1', 'Emptied');
    const kept = addSegment('image-1', 'Kept');
    seedVoxel(emptied, [0, 0, 0]);
    seedVoxel(kept, [0, 0, 0]);
    seedVoxel(kept, [1, 0, 0]);

    await processStore.startProcess(
      async (target: ProcessTarget) =>
        target.segmentId === emptied
          ? emptyingProcess(target)
          : { scalars: new Uint8Array([0, 1]), extent: target.maskExtent },
      { requiresActiveSegment: false }
    );
    processStore.confirmProcess();

    expect(!!segmentationStore.maskOf(emptied)).toBe(false);
    // The run ends before the deletion, which would otherwise roll this back.
    expect(markedVoxels(kept)).toEqual([[1, 0, 0, SEGMENT_VALUE]]);
  });
});
