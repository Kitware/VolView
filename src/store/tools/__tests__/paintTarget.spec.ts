import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { DEFAULT_SEGMENT_MASKS } from '@/src/config';
import { PaintMode } from '@/src/core/tools/paint';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  markedVoxels,
  maskValueAt,
} from '@/src/store/__tests__/segmentMaskFixtures';

const DIMENSIONS: [number, number, number] = [4, 4, 2];
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

const store = () => useSegmentationStore();

const bindingOf = (segmentId: string) =>
  store().resolveLabelmapBinding(segmentId);

/** Creates a segment with voxel storage already allocated. */
function boundSegment(segmentationId: string, name: string) {
  const segment = store().createSegment(segmentationId, { name });
  store().ensureLabelmapBinding(segment.id);
  return segment;
}

/** A one-voxel stroke on the K axis; unit spacing makes world points index points. */
function strokeAt(imageId: string, point: [number, number, number]) {
  const paintStore = usePaintToolStore();
  paintStore.setBrushSize(1);
  paintStore.startStroke(point, 2, imageId);
  paintStore.endStroke(point, 2, imageId);
}

describe('paint edit target', () => {
  beforeEach(() => {
    const pinia = createPinia().use(CorePiniaProviderPlugin());
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  it('writes the active segment’s resolved label value', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    boundSegment(segmentation.id, 'Other');
    const active = boundSegment(segmentation.id, 'Tumor');
    store().setActiveSegment(active.id);

    strokeAt('img-1', [1, 1, 0]);

    const binding = bindingOf(active.id)!;
    expect(binding.labelValue).toBe(2);
    expect(maskValueAt(active.id, [1, 1, 0])).toBe(binding.labelValue);
  });

  it('writes into the artifact of the image being painted', async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const first = store().ensureSegmentationForImage('img-1');
    const source = boundSegment(first.id, 'Tumor');
    store().setActiveSegment(source.id);

    strokeAt('img-2', [1, 1, 0]);

    const cloned = store().activeSegmentId!;
    expect(
      store().getSegmentationForImage('img-2')!.segments[cloned]
    ).toBeDefined();
    const clonedBinding = bindingOf(cloned)!;
    const sourceBinding = bindingOf(source.id)!;
    expect(clonedBinding.artifactId).not.toBe(sourceBinding.artifactId);
    expect(maskValueAt(cloned, [1, 1, 0])).toBe(clonedBinding.labelValue);
    expect(markedVoxels(source.id)).toEqual([]);
  });

  it('seeds a segmentation and a segment on the first stroke', async () => {
    await seatImage('img-1');

    strokeAt('img-1', [1, 1, 0]);

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toHaveLength(1);
    const [segmentId] = segmentation.order;
    expect(segmentation.segments[segmentId].name).toBe(
      DEFAULT_SEGMENT_MASKS[0].name
    );
    expect(store().activeSegmentId).toBe(segmentId);
    const binding = bindingOf(segmentId)!;
    expect(maskValueAt(segmentId, [1, 1, 0])).toBe(binding.labelValue);
  });

  it('erases only the active segment’s voxels', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    const paintStore = usePaintToolStore();

    store().setActiveSegment(neighbor.id);
    strokeAt('img-1', [1, 1, 0]);
    store().setActiveSegment(active.id);
    strokeAt('img-1', [2, 1, 0]);

    paintStore.setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [2, 1, 0]);

    const neighborBinding = bindingOf(neighbor.id)!;
    expect(maskValueAt(neighbor.id, [1, 1, 0])).toBe(
      neighborBinding.labelValue
    );
    expect(markedVoxels(active.id)).toEqual([]);
  });

  it('blocks a stroke when the active segment is locked', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    store().updateSegment(active.id, { locked: true });
    store().setActiveSegment(active.id);

    strokeAt('img-1', [1, 1, 0]);

    expect(markedVoxels(active.id)).toEqual([]);
  });

  it('paints past a locked neighbour without overwriting it', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');

    store().setActiveSegment(neighbor.id);
    strokeAt('img-1', [1, 1, 0]);
    store().updateSegment(neighbor.id, { locked: true });

    store().setActiveSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [3, 1, 0]);

    const neighborBinding = bindingOf(neighbor.id)!;
    const activeBinding = bindingOf(active.id)!;
    expect(maskValueAt(neighbor.id, [1, 1, 0])).toBe(
      neighborBinding.labelValue
    );
    expect(maskValueAt(active.id, [3, 1, 0])).toBe(activeBinding.labelValue);
  });

  it('creates nothing when the paint tool is merely activated', async () => {
    await seatImage('img-1');
    const paintStore = usePaintToolStore();

    paintStore.activateTool();

    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
    expect(store().artifactsForImage('img-1')).toEqual([]);
  });
});
