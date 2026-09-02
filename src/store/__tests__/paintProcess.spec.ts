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
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  usePaintProcessStore,
  type ProcessTarget,
} from '@/src/store/tools/paintProcess';
import { useViewStore } from '@/src/store/views';

/** Seats a two-voxel image and makes it the one the active view shows. */
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

/** Seats one segment, grown to the whole image, and makes it active. */
function addTestSegment(
  values = new Uint8Array([0, 0]),
  labelValue = 1,
  imageId = 'image-1'
) {
  const segmentationStore = useSegmentationStore();
  const segmentation = segmentationStore.ensureSegmentationForImage(imageId);
  // Label values are minted per image, so the ones below the wanted value are
  // taken by placeholder segments.
  for (let value = 1; value < labelValue; value += 1) {
    const filler = segmentationStore.createSegment(segmentation.id, {
      name: `Filler ${value}`,
    });
    segmentationStore.segmentVoxels(filler.id).materialize();
  }

  const segment = segmentationStore.createSegment(segmentation.id, {
    name: 'Segment 1',
  });
  const voxels = segmentationStore.segmentVoxels(segment.id);
  const { artifactId } = voxels.materialize();
  voxels.ensureContains([0, values.length - 1, 0, 0, 0, 0]);
  voxels.apply(values);
  segmentationStore.setActiveSegment(segment.id);

  return {
    segmentationId: segmentation.id,
    segmentId: segment.id,
    artifactId,
    labelMap: voxels.image(),
  };
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
    const { labelMap } = addTestSegment();

    paintStore.setMode(PaintMode.Erase);

    expect(paintStore.processControlsOpen).toBe(false);

    await processStore.startProcess(async () => new Uint8Array([2, 2]));

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
    const { labelMap } = addTestSegment();

    paintStore.setMode(PaintMode.CirclePaint);
    paintStore.setProcessControlsOpen(true);

    await processStore.startProcess(async () => new Uint8Array([3, 3]));

    expect(getScalars(labelMap)).toEqual([3, 3]);

    processStore.cancelProcess();

    expect(processStore.processState.step).toBe('start');
    expect(paintStore.processControlsOpen).toBe(true);
    expect(paintStore.activeMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.activePaintMode).toBe(PaintMode.CirclePaint);
    expect(paintStore.isPaintingModeActive).toBe(true);
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('ignores stale async results after a newer process starts', async () => {
    const paintStore = usePaintToolStore();
    const { labelMap } = addTestSegment();

    paintStore.activeMode = PaintMode.Process;
    const processStore = usePaintProcessStore();

    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const firstRun = processStore.startProcess(() => first.promise);
    const secondRun = processStore.startProcess(() => second.promise);

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
    const { labelMap } = addTestSegment(new Uint8Array([0, 0]), 3);
    let target: ProcessTarget | undefined;
    const algorithm = vi.fn(async (resolved: ProcessTarget) => {
      target = resolved;
      return new Uint8Array([3, 3]);
    });

    await processStore.startProcess(algorithm);

    expect(algorithm).toHaveBeenCalledTimes(1);
    expect(target).toMatchObject({ scope: 'segment', labelValue: 3 });
    expect(target!.voxels.image()).toBe(labelMap);
  });

  it('refuses to process a locked segment', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();
    const { segmentId, labelMap } = addTestSegment();
    segmentationStore.updateSegment(segmentId, {
      locked: true,
    });

    await processStore.startProcess(async () => new Uint8Array([2, 2]));

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
    expect(
      messageStore.messages.some((message) =>
        message.title.includes('locked segment')
      )
    ).toBe(true);
  });

  it('processes the labelmap of the image being viewed', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { labelMap: firstLabelMap } = addTestSegment();
    let target: ProcessTarget | undefined;
    const algorithm = vi.fn(async (resolved: ProcessTarget) => {
      target = resolved;
      return new Uint8Array(resolved.voxels.scalars().length).fill(4);
    });

    await viewImage('image-2');
    await processStore.startProcess(algorithm);

    const active = segmentationStore.activeSegmentId!;
    expect(
      segmentationStore.getSegmentationForImage('image-2')!.segments[active]
    ).toBeDefined();
    const binding = segmentationStore.resolveLabelmapBinding(active)!;
    expect(target).toMatchObject({
      scope: 'segment',
      labelValue: binding.labelValue,
    });
    expect(target!.voxels.image()).toBe(binding.labelmap);
    // The clone covers nothing yet, so the process had no voxels to write, and
    // the segment of the image left behind is untouched either way.
    expect(getScalars(binding.labelmap)).toEqual([]);
    expect(getScalars(firstLabelMap)).toEqual([0, 0]);
  });

  it('cancels the preview when the active segment changes', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const { segmentationId, labelMap } = addTestSegment();

    await processStore.startProcess(async () => new Uint8Array([2, 2]));
    expect(processStore.processState.step).toBe('previewing');

    const other = segmentationStore.createSegment(segmentationId, {
      name: 'Other',
    });
    segmentationStore.setActiveSegment(other.id);
    await nextTick();

    expect(processStore.processState.step).toBe('start');
    expect(getScalars(labelMap)).toEqual([0, 0]);
  });

  it('does not create a segment for an all-segments process on a bare image', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    const messageStore = useMessageStore();

    await processStore.startProcess(async () => new Uint8Array([2, 2]), {
      requiresActiveSegment: false,
    });

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

  it('does not clone the active segment onto a merely viewed image', async () => {
    const processStore = usePaintProcessStore();
    const segmentationStore = useSegmentationStore();
    addTestSegment();
    await viewImage('image-2');

    await processStore.startProcess(async () => new Uint8Array([2, 2]), {
      requiresActiveSegment: false,
    });

    expect(
      segmentationStore.getSegmentationForImage('image-2')
    ).toBeUndefined();
  });
});
