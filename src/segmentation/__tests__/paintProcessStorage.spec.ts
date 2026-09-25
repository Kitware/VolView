import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import {
  mintSegment,
  lockSegment,
  addActiveSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/segmentation/editing/paintProcess';
import { PaintMode } from '@/src/core/tools/paint';
import { useViewStore } from '@/src/store/views';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import { defer } from '@/src/utils';

// ---------------------------------------------------------------------------
// How the process state machine touches storage. Preview, toggle, confirm and
// cancel go through the accessor's snapshot()/apply() rather than swapping
// typed arrays into the live labelmap, so the buffer the mappers and the paint
// engine hold stays the one that is written.
//
// It also pins how a run is scoped: every process writes one segment's own
// bounded mask, and an all-segments process is one run per editable segment.
// ---------------------------------------------------------------------------

async function viewImage(
  id: string,
  dimensions: [number, number, number] = [2, 1, 1]
) {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(dimensions);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, id, { id });
  useViewStore().setDataForAllViews(id);
  await nextTick();
  return id;
}

/** Another segment of the same image, grown to the same two voxels. */
function addBoundSegment(segmentationId: string, name: string) {
  const segmentationStore = useSegmentationStore();
  const segment = segmentationStore.createMask(
    segmentationId,
    mintSegment({ name })
  );
  const voxels = segmentationStore.maskVoxels(segment.id);
  voxels.materialize();
  const labelValue = SEGMENT_VALUE;
  voxels.ensureContains([0, 1, 0, 0, 0, 0]);
  return { maskId: segment.id, labelValue };
}

const buffer = (labelMap: vtkLabelMap) =>
  labelMap.getPointData().getScalars().getData();

const values = (labelMap: vtkLabelMap) => Array.from(buffer(labelMap));

function expectRolledBack(
  labelMap: vtkLabelMap,
  original: ReturnType<typeof buffer>
) {
  expect(usePaintProcessStore().processState.step).toBe('start');
  expect(buffer(labelMap)).toBe(original);
  expect(values(labelMap)).toEqual([1, 0]);
  expect(
    useMessageStore().messages.some((message) =>
      message.title.includes('Operation Failed')
    )
  ).toBe(true);
}

function recordingAlgorithm(result: () => Uint8Array) {
  const seen: ProcessTarget[] = [];
  return {
    seen,
    algorithm: async (target: ProcessTarget) => {
      seen.push(target);
      return { scalars: result(), extent: target.maskExtent };
    },
  };
}

async function allSegmentsTargets() {
  const { seen, algorithm } = recordingAlgorithm(() => new Uint8Array([2, 2]));
  await usePaintProcessStore().startProcess(algorithm, {
    requiresActiveSegment: false,
  });
  return seen;
}

const startedProcess = async (options?: { requiresActiveSegment: boolean }) => {
  const processStore = usePaintProcessStore();
  const { labelMap, maskId } = addActiveSegment(new Uint8Array([1, 0]));
  const original = buffer(labelMap);
  const { algorithm } = recordingAlgorithm(() => new Uint8Array([1, 1]));
  await processStore.startProcess(algorithm, options);
  return { processStore, labelMap, original, maskId };
};

describe('paint process storage', () => {
  beforeEach(async () => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
    await viewImage('image-1');
  });

  describe('the process target', () => {
    it('hands a segment-scoped process the segment it writes', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment(new Uint8Array([0, 0]), 3);
      const { seen, algorithm } = recordingAlgorithm(
        () => new Uint8Array([3, 3])
      );

      await processStore.startProcess(algorithm);

      expect(seen).toHaveLength(1);
      const [target] = seen;
      expect(target).toMatchObject({
        parentImageId: 'image-1',
        parentDimensions: [2, 1, 1],
        maskExtent: [0, 1, 0, 0, 0, 0],
        labelValue: SEGMENT_VALUE,
      });
      expect(target.scalars).not.toBe(buffer(labelMap));
    });

    it('runs an all-segments process once per editable segment', async () => {
      const { segmentationId, maskId } = addActiveSegment(
        new Uint8Array([1, 0])
      );
      const other = addBoundSegment(segmentationId, 'Other');

      const seen = await allSegmentsTargets();

      expect(seen.map((target) => target.maskId)).toEqual([
        maskId,
        other.maskId,
      ]);
      // Each run gets that segment's own mask, not a composite of them all.
      expect(Array.from(seen[0].scalars)).toEqual([1, 0]);
      expect(seen[1].scalars).not.toBe(seen[0].scalars);
      expect(seen.map((target) => target.labelValue)).toEqual([
        1,
        other.labelValue,
      ]);
    });

    it('skips a locked segment and one with no voxels', async () => {
      const segmentationStore = useSegmentationStore();
      const { segmentationId, maskId } = addActiveSegment(
        new Uint8Array([1, 0])
      );
      const locked = addBoundSegment(segmentationId, 'Locked');
      lockSegment(locked.maskId, true);
      const empty = segmentationStore.createMask(
        segmentationId,
        mintSegment({
          name: 'Empty',
        })
      );
      segmentationStore.maskVoxels(empty.id).materialize();

      const seen = await allSegmentsTargets();

      expect(seen.map((target) => target.maskId)).toEqual([maskId]);
    });

    it('gives the algorithm a detached snapshot', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment(new Uint8Array([1, 0]));
      let live: unknown;
      let seenAtCall: number[] = [];

      await processStore.startProcess(async (target) => {
        live = target.scalars;
        seenAtCall = Array.from(target.scalars.slice());
        return { scalars: new Uint8Array([1, 1]), extent: target.maskExtent };
      });

      expect(live).not.toBe(buffer(labelMap));
      expect(seenAtCall).toEqual([1, 0]);
    });
  });

  describe('preview', () => {
    it('writes the result through the live buffer instead of swapping it', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment();
      const original = buffer(labelMap);

      await processStore.startProcess(async (target: ProcessTarget) => ({
        scalars: new Uint8Array([2, 2]),
        extent: target.maskExtent,
      }));

      expect(processStore.processState.step).toBe('previewing');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([2, 2]);
    });

    it('copies the algorithm result instead of adopting it', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment();
      const result = new Uint8Array([2, 2]);

      await processStore.startProcess(async (target) => ({
        scalars: result,
        extent: target.maskExtent,
      }));
      result[0] = 9;

      expect(values(labelMap)).toEqual([2, 2]);
    });
  });

  describe('selecting the preview', () => {
    it('swaps values in place in both directions', async () => {
      const { processStore, labelMap, original } = await startedProcess();
      expect(values(labelMap)).toEqual([1, 1]);

      processStore.setShowingOriginal(true);

      expect(processStore.showingOriginal).toBe(true);
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 0]);

      processStore.setShowingOriginal(false);

      expect(processStore.showingOriginal).toBe(false);
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 1]);
    });

    it('selects a named preview idempotently', async () => {
      const { processStore, labelMap } = await startedProcess();

      processStore.setShowingOriginal(false);
      expect(values(labelMap)).toEqual([1, 1]);

      processStore.setShowingOriginal(true);
      expect(values(labelMap)).toEqual([1, 0]);
      processStore.setShowingOriginal(true);
      expect(values(labelMap)).toEqual([1, 0]);

      processStore.setShowingOriginal(false);
      expect(values(labelMap)).toEqual([1, 1]);
    });
  });

  describe('cancel', () => {
    it('restores the original values in place', async () => {
      const { processStore, labelMap, original } = await startedProcess();
      processStore.cancelProcess();

      expect(processStore.processState.step).toBe('start');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 0]);
    });
  });

  describe('confirm', () => {
    it('keeps the processed result in place when the original is showing', async () => {
      const { processStore, labelMap, original } = await startedProcess();
      processStore.setShowingOriginal(true);
      processStore.confirmProcess();

      expect(processStore.processState.step).toBe('start');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 1]);
    });
  });

  describe('storage deleted mid-preview', () => {
    const cancelsWhenTheSegmentGoes = async (options?: {
      requiresActiveSegment: boolean;
    }) => {
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { maskId, processStore } = await startedProcess(options);

      expect(processStore.processState.step).toBe('previewing');

      segmentationStore.deleteMask(maskId);
      await nextTick();

      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    };

    it('cancels when the previewed segment is deleted', () =>
      cancelsWhenTheSegmentGoes());

    it('cancels even when the run did not require an active segment', () =>
      cancelsWhenTheSegmentGoes({ requiresActiveSegment: false }));

    it('confirms without a write when the storage is gone', async () => {
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { maskId, processStore } = await startedProcess();

      processStore.setShowingOriginal(true);
      segmentationStore.deleteMask(maskId);

      expect(() => processStore.confirmProcess()).not.toThrow();
      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });

    it('ends the preview before its storage is deleted', async () => {
      const segmentationStore = useSegmentationStore();
      const { maskId, processStore } = await startedProcess();

      segmentationStore.deleteMask(maskId);

      expect(() => processStore.setShowingOriginal(true)).not.toThrow();
      expect(processStore.processStep).toBe('start');
    });

    it('abandons the run when the storage goes away while the algorithm runs', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { maskId } = addActiveSegment();

      await processStore.startProcess(async (target) => {
        segmentationStore.deleteMask(maskId);
        return { scalars: new Uint8Array([1, 1]), extent: target.maskExtent };
      });

      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });
  });

  describe('storage reshaped mid-preview', () => {
    it('cancels without throwing when another tool grew the mask', async () => {
      const processStore = usePaintProcessStore();
      const segmentationStore = useSegmentationStore();
      await viewImage('image-2', [4, 1, 1]);
      const { maskId } = addActiveSegment(new Uint8Array([1, 0]), 1, 'image-2');

      await processStore.startProcess(async (target: ProcessTarget) => ({
        scalars: new Uint8Array([1, 1]),
        extent: target.maskExtent,
      }));
      expect(processStore.processState.step).toBe('previewing');

      // A polygon on the same segment grows the mask, so the snapshot the
      // preview holds no longer has the shape the storage does.
      segmentationStore.maskVoxels(maskId).ensureContains([0, 3, 0, 0, 0, 0]);

      expect(() => processStore.cancelProcess()).not.toThrow();
      expect(processStore.processState.step).toBe('start');
    });

    it('cancels the preview when the paint tool is put down', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const { labelMap } = addActiveSegment(new Uint8Array([1, 0]));
      paintStore.activateTool();

      await processStore.startProcess(async (target: ProcessTarget) => ({
        scalars: new Uint8Array([1, 1]),
        extent: target.maskExtent,
      }));
      expect(processStore.processState.step).toBe('previewing');

      paintStore.deactivateTool();
      await nextTick();

      expect(processStore.processState.step).toBe('start');
      expect(values(labelMap)).toEqual([1, 0]);
    });
  });

  describe('an algorithm that edits its input snapshot', () => {
    it('previews its result and cancels back to the original', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment(new Uint8Array([1, 0]));

      await processStore.startProcess(async (target) => {
        const live = target.scalars;
        live[1] = 1;
        expect(values(labelMap)).toEqual([1, 0]);
        return { scalars: live, extent: target.maskExtent };
      });

      expect(values(labelMap)).toEqual([1, 1]);
      processStore.cancelProcess();
      expect(values(labelMap)).toEqual([1, 0]);
    });
  });

  describe('a result that does not fit the storage', () => {
    it('is refused, reported, and rolled back', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addActiveSegment(new Uint8Array([1, 0]));
      const original = buffer(labelMap);

      await processStore.startProcess(async (target: ProcessTarget) => ({
        scalars: new Uint8Array([1, 1, 1]),
        extent: target.maskExtent,
      }));

      expectRolledBack(labelMap, original);
      expect(labelMap.getDimensions()).toEqual([2, 1, 1]);
    });
  });

  describe('live target locks', () => {
    it('cancels computing immediately, discards late output, and allows an unlocked retry', async () => {
      const { maskId, labelMap } = addActiveSegment(new Uint8Array([1, 0]));
      const process = usePaintProcessStore();
      const paint = usePaintToolStore();
      paint.setMode(PaintMode.Erase);
      const release = defer<void>();
      const running = process.startProcess(async (target) => {
        await release.promise;
        return { scalars: new Uint8Array([1, 1]), extent: target.maskExtent };
      });
      lockSegment(maskId);
      // Even a lock/unlock within one task invalidates the pending operation.
      lockSegment(maskId, false);
      expect(process.processStep).toBe('start');
      expect(paint.activeMode).toBe(PaintMode.Erase);
      const { algorithm } = recordingAlgorithm(() => new Uint8Array(2));
      await process.startProcess(algorithm);
      release.resolve();
      await running;
      expect(process.processStep).toBe('previewing');
      expect(values(labelMap)).toEqual([0, 0]);
      process.cancelProcess();
      expect(values(labelMap)).toEqual([1, 0]);
      expect(paint.activeMode).toBe(PaintMode.Erase);
    });

    it.each(['confirmProcess', 'setShowingOriginal'] as const)(
      'refuses %s in the same turn as locking an Original preview',
      async (action) => {
        const { processStore, labelMap, maskId } = await startedProcess();
        processStore.setShowingOriginal(true);
        expect(values(labelMap)).toEqual([1, 0]);
        lockSegment(maskId);
        if (action === 'confirmProcess') processStore.confirmProcess();
        else processStore.setShowingOriginal(false);
        expect(processStore.processStep).toBe('start');
        expect(values(labelMap)).toEqual([1, 0]);
        expect(usePaintToolStore().activeMode).not.toBe(PaintMode.Process);
      }
    );

    it('rolls back a processed preview immediately when its target locks', async () => {
      const { processStore, labelMap, maskId } = await startedProcess();
      expect(values(labelMap)).toEqual([1, 1]);
      lockSegment(maskId);
      expect(values(labelMap)).toEqual([1, 0]);
      expect(processStore.processStep).toBe('start');
    });

    it.each(['computing', 'previewing'])(
      'cancels all targets when one locks during %s',
      async (step) => {
        const { segmentationId, maskId, labelMap } = addActiveSegment(
          new Uint8Array([1, 0])
        );
        const second = addBoundSegment(segmentationId, 'Second');
        const secondVoxels = useSegmentationStore().maskVoxels(second.maskId);
        secondVoxels.apply(new Uint8Array([0, 1]));
        const process = usePaintProcessStore();
        const release = defer<void>();
        const running = process.startProcess(
          async (target) => {
            await release.promise;
            return { scalars: new Uint8Array(2), extent: target.maskExtent };
          },
          { requiresActiveSegment: false }
        );
        if (step === 'previewing') {
          release.resolve();
          await running;
          expect(values(labelMap)).toEqual([0, 0]);
          expect(Array.from(secondVoxels.scalars())).toEqual([0, 0]);
        }
        lockSegment(second.maskId);
        release.resolve();
        await running;
        expect(process.processStep).toBe('start');
        expect(values(labelMap)).toEqual([1, 0]);
        expect(Array.from(secondVoxels.scalars())).toEqual([0, 1]);
        expect(useSegmentationStore().isLocked(maskId)).toBe(false);
      }
    );

    it('keeps a scoped preview when an unrelated segment locks', async () => {
      const { processStore, labelMap } = await startedProcess();
      const segmentation =
        useSegmentationStore().getSegmentationForImage('image-1')!;
      const unrelated = addBoundSegment(segmentation.id, 'Unrelated');
      lockSegment(unrelated.maskId);
      await nextTick();
      expect(processStore.processStep).toBe('previewing');
      processStore.confirmProcess();
      expect(values(labelMap)).toEqual([1, 1]);
    });
  });
});
