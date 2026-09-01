import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLabelMap from '@/src/vtk/LabelMap';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/store/tools/paintProcess';
import { PaintMode } from '@/src/core/tools/paint';
import { useViewStore } from '@/src/store/views';

// ---------------------------------------------------------------------------
// How the process state machine touches storage. Preview, toggle, confirm and
// cancel go through the accessor's snapshot()/apply() rather than swapping
// typed arrays into the live labelmap, so the buffer the mappers and the paint
// engine hold stays the one that is written.
//
// It also pins the ProcessTarget union: an all-segments process has an
// artifact and no segment, so it carries no label value.
// ---------------------------------------------------------------------------

function makeLabelMap(values: Uint8Array) {
  const labelMap = vtkLabelMap.newInstance();
  labelMap.setDimensions([values.length, 1, 1]);
  labelMap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values,
    })
  );
  labelMap.computeTransforms();
  return labelMap;
}

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

/** Seats one artifact carrying one segment, and makes that segment active. */
function addTestSegment(values = new Uint8Array([0, 0]), labelValue = 1) {
  const segmentationStore = useSegmentationStore();
  const labelMap = makeLabelMap(values);
  const artifactId = segmentationStore.registerArtifact(labelMap, {
    name: 'Test group',
    parentImage: 'image-1',
  });
  const [segment] = segmentationStore.setArtifactSegments(artifactId, [
    {
      value: labelValue,
      name: 'Segment 1',
      color: [255, 0, 0, 255],
      visible: true,
      locked: false,
    },
  ]);
  const segmentationId =
    segmentationStore.getSegmentationForImage('image-1')!.id;
  segmentationStore.setActiveSegment(segment.id);

  return { segmentationId, segmentId: segment.id, artifactId, labelMap };
}

const buffer = (labelMap: vtkLabelMap) =>
  labelMap.getPointData().getScalars().getData();

const values = (labelMap: vtkLabelMap) => Array.from(buffer(labelMap));

/** Records the target the process resolved, and returns a fixed result. */
function recordingAlgorithm(result: () => Uint8Array) {
  const seen: ProcessTarget[] = [];
  return {
    seen,
    algorithm: async (target: ProcessTarget) => {
      seen.push(target);
      return result();
    },
  };
}

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
      const { labelMap, artifactId } = addTestSegment(
        new Uint8Array([0, 0]),
        3
      );
      const { seen, algorithm } = recordingAlgorithm(
        () => new Uint8Array([3, 3])
      );

      await processStore.startProcess(algorithm);

      expect(seen).toHaveLength(1);
      const [target] = seen;
      expect(target).toMatchObject({
        scope: 'segment',
        artifactId,
        labelValue: 3,
      });
      expect(target.voxels.image()).toBe(labelMap);
    });

    it('hands an all-segments process an artifact and no label value', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap, artifactId } = addTestSegment();
      const { seen, algorithm } = recordingAlgorithm(
        () => new Uint8Array([2, 2])
      );

      await processStore.startProcess(algorithm, {
        requiresActiveSegment: false,
      });

      expect(seen).toHaveLength(1);
      const [target] = seen;
      expect(target).toMatchObject({ scope: 'artifact', artifactId });
      // An artifact-scoped target carries no label value at all.
      expect('labelValue' in target).toBe(false);
      expect(target.voxels.image()).toBe(labelMap);
    });

    it('gives the target accessor the storage the process reads', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment(new Uint8Array([1, 0]));
      let live: unknown;
      let seenAtCall: number[] = [];

      await processStore.startProcess(async (target) => {
        live = target.voxels.scalars();
        seenAtCall = Array.from(target.voxels.snapshot());
        return new Uint8Array([1, 1]);
      });

      // The algorithm reads the voxels as they stand when it runs.
      expect(live).toBe(buffer(labelMap));
      expect(seenAtCall).toEqual([1, 0]);
    });
  });

  describe('preview', () => {
    it('writes the result through the live buffer instead of swapping it', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment();
      const original = buffer(labelMap);

      await processStore.startProcess(async () => new Uint8Array([2, 2]));

      expect(processStore.processState.step).toBe('previewing');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([2, 2]);
    });

    it('copies the algorithm result instead of adopting it', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment();
      const result = new Uint8Array([2, 2]);

      await processStore.startProcess(async () => result);
      result[0] = 9;

      expect(values(labelMap)).toEqual([2, 2]);
    });
  });

  describe('toggling the preview', () => {
    it('swaps values in place in both directions', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment(new Uint8Array([1, 0]));
      const original = buffer(labelMap);

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      expect(values(labelMap)).toEqual([1, 1]);

      processStore.togglePreview();

      expect(processStore.showingOriginal).toBe(true);
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 0]);

      processStore.togglePreview();

      expect(processStore.showingOriginal).toBe(false);
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 1]);
    });
  });

  describe('cancel', () => {
    it('restores the original values in place', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment(new Uint8Array([1, 0]));
      const original = buffer(labelMap);

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      processStore.cancelProcess();

      expect(processStore.processState.step).toBe('start');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 0]);
    });
  });

  describe('confirm', () => {
    it('keeps the processed result in place when the original is showing', async () => {
      const processStore = usePaintProcessStore();
      const { labelMap } = addTestSegment(new Uint8Array([1, 0]));
      const original = buffer(labelMap);

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      processStore.togglePreview();
      processStore.confirmProcess();

      expect(processStore.processState.step).toBe('start');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 1]);
    });
  });

  describe('storage deleted mid-preview', () => {
    it('cancels when the previewed segment is deleted', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { segmentId } = addTestSegment();

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      expect(processStore.processState.step).toBe('previewing');

      segmentationStore.deleteSegment(segmentId);
      await nextTick();

      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });

    it('cancels when the previewed artifact is removed', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { artifactId } = addTestSegment();

      await processStore.startProcess(async () => new Uint8Array([1, 1]), {
        requiresActiveSegment: false,
      });
      expect(processStore.processState.step).toBe('previewing');

      segmentationStore.removeArtifact(artifactId);
      await nextTick();

      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });

    it('confirms without a write when the storage is gone', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { artifactId } = addTestSegment(new Uint8Array([1, 0]));

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      processStore.togglePreview();
      segmentationStore.removeArtifact(artifactId);

      expect(() => processStore.confirmProcess()).not.toThrow();
      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });

    it('toggles the preview without a write when the storage is gone', async () => {
      const processStore = usePaintProcessStore();
      const segmentationStore = useSegmentationStore();
      const { artifactId } = addTestSegment(new Uint8Array([1, 0]));

      await processStore.startProcess(async () => new Uint8Array([1, 1]));
      segmentationStore.removeArtifact(artifactId);

      expect(() => processStore.togglePreview()).not.toThrow();
      expect(processStore.showingOriginal).toBe(true);
    });

    it('abandons the run when the storage goes away while the algorithm runs', async () => {
      const processStore = usePaintProcessStore();
      const paintStore = usePaintToolStore();
      const segmentationStore = useSegmentationStore();
      const { artifactId } = addTestSegment();

      await processStore.startProcess(async () => {
        segmentationStore.removeArtifact(artifactId);
        return new Uint8Array([1, 1]);
      });

      expect(processStore.processState.step).toBe('start');
      expect(paintStore.activeMode).not.toBe(PaintMode.Process);
    });
  });

  describe('a result that does not fit the storage', () => {
    it('is refused, reported, and rolled back', async () => {
      const processStore = usePaintProcessStore();
      const messageStore = useMessageStore();
      const { labelMap } = addTestSegment(new Uint8Array([1, 0]));
      const original = buffer(labelMap);

      await processStore.startProcess(async () => new Uint8Array([1, 1, 1]));

      expect(processStore.processState.step).toBe('start');
      expect(buffer(labelMap)).toBe(original);
      expect(values(labelMap)).toEqual([1, 0]);
      expect(labelMap.getDimensions()).toEqual([2, 1, 1]);
      expect(
        messageStore.messages.some((message) =>
          message.title.includes('Operation Failed')
        )
      ).toBe(true);
    });
  });
});
