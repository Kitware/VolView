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

const DIMENSIONS: [number, number, number] = [4, 4, 2];
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

/** Index-space [i, j, k] to a flat scalar offset in a [4, 4, 2] volume. */
const offsetOf = (i: number, j: number, k: number) =>
  i + j * DIMENSIONS[0] + k * DIMENSIONS[0] * DIMENSIONS[1];

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

const bindingOf = (segmentationId: string, segmentId: string) =>
  store().resolveLabelmapBinding(segmentationId, segmentId);

const artifactScalars = (artifactId: string) =>
  Array.from(
    store().artifactIndex[artifactId].getPointData().getScalars().getData()
  );

/** Creates a segment with voxel storage already allocated. */
function boundSegment(segmentationId: string, name: string) {
  const segment = store().createSegment(segmentationId, { name });
  store().ensureLabelmapBinding(segmentationId, segment.id);
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
    store().setActiveSegment(segmentation.id, active.id);

    strokeAt('img-1', [1, 1, 0]);

    const binding = bindingOf(segmentation.id, active.id)!;
    expect(binding.labelValue).toBe(2);
    expect(artifactScalars(binding.artifactId)[offsetOf(1, 1, 0)]).toBe(
      binding.labelValue
    );
  });

  it('writes into the artifact of the image being painted', async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const first = store().ensureSegmentationForImage('img-1');
    const source = boundSegment(first.id, 'Tumor');
    store().setActiveSegment(first.id, source.id);

    strokeAt('img-2', [1, 1, 0]);

    const cloned = store().activeTarget!;
    expect(cloned.segmentationId).toBe(
      store().getSegmentationForImage('img-2')!.id
    );
    const clonedBinding = bindingOf(cloned.segmentationId, cloned.segmentId)!;
    const sourceBinding = bindingOf(first.id, source.id)!;
    expect(clonedBinding.artifactId).not.toBe(sourceBinding.artifactId);
    expect(artifactScalars(clonedBinding.artifactId)[offsetOf(1, 1, 0)]).toBe(
      clonedBinding.labelValue
    );
    expect(
      artifactScalars(sourceBinding.artifactId).every((value) => value === 0)
    ).toBe(true);
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
    expect(store().activeTarget).toEqual({
      segmentationId: segmentation.id,
      segmentId,
    });
    const binding = bindingOf(segmentation.id, segmentId)!;
    expect(artifactScalars(binding.artifactId)[offsetOf(1, 1, 0)]).toBe(
      binding.labelValue
    );
  });

  it('erases only the active segment’s voxels', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    const paintStore = usePaintToolStore();

    store().setActiveSegment(segmentation.id, neighbor.id);
    strokeAt('img-1', [1, 1, 0]);
    store().setActiveSegment(segmentation.id, active.id);
    strokeAt('img-1', [2, 1, 0]);

    paintStore.setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [2, 1, 0]);

    const neighborBinding = bindingOf(segmentation.id, neighbor.id)!;
    const scalars = artifactScalars(neighborBinding.artifactId);
    expect(scalars[offsetOf(1, 1, 0)]).toBe(neighborBinding.labelValue);
    expect(scalars[offsetOf(2, 1, 0)]).toBe(0);
  });

  it('blocks a stroke when the active segment is locked', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    store().updateSegment(segmentation.id, active.id, { locked: true });
    store().setActiveSegment(segmentation.id, active.id);

    strokeAt('img-1', [1, 1, 0]);

    const binding = bindingOf(segmentation.id, active.id)!;
    expect(
      artifactScalars(binding.artifactId).every((value) => value === 0)
    ).toBe(true);
  });

  it('paints past a locked neighbour without overwriting it', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');

    store().setActiveSegment(segmentation.id, neighbor.id);
    strokeAt('img-1', [1, 1, 0]);
    store().updateSegment(segmentation.id, neighbor.id, { locked: true });

    store().setActiveSegment(segmentation.id, active.id);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [3, 1, 0]);

    const neighborBinding = bindingOf(segmentation.id, neighbor.id)!;
    const activeBinding = bindingOf(segmentation.id, active.id)!;
    const scalars = artifactScalars(neighborBinding.artifactId);
    expect(scalars[offsetOf(1, 1, 0)]).toBe(neighborBinding.labelValue);
    expect(scalars[offsetOf(3, 1, 0)]).toBe(activeBinding.labelValue);
  });
});
