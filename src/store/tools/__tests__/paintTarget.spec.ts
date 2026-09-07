import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createApp } from 'vue';

import { PaintMode } from '@/src/core/tools/paint';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { usePaintToolStore } from '@/src/store/tools/paint';
import {
  seatSpecImage as seatImage,
  markedVoxels,
  maskValueAt,
  offsetOf,
  selectSegment,
  mintSegment,
  lockSegment,
} from '@/src/store/__tests__/segmentMaskFixtures';

const store = () => useSegmentationStore();

const bindingOf = (maskId: string) => store().resolveLabelmapBinding(maskId);

/** Creates a segment with voxel storage already allocated. */
function boundSegment(segmentationId: string, name: string) {
  const segment = store().createMask(segmentationId, mintSegment({ name }));
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

function paintAndLock(maskId: string) {
  selectSegment(maskId);
  strokeAt('img-1', [1, 1, 0]);
  lockSegment(maskId, true);
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
    selectSegment(active.id);

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
    selectSegment(source.id);

    strokeAt('img-2', [1, 1, 0]);

    // The type is shared; this image gets its own record and its own mask.
    const painted = store().findEditTarget('img-2')!;
    expect(store().getMask(painted).segmentId).toBe(source.segmentId);
    const paintedBinding = bindingOf(painted)!;
    const sourceBinding = bindingOf(source.id)!;
    expect(paintedBinding.artifactId).not.toBe(sourceBinding.artifactId);
    expect(maskValueAt(painted, [1, 1, 0])).toBe(paintedBinding.labelValue);
    expect(markedVoxels(source.id)).toEqual([]);
  });

  it('seeds a segmentation and a segment on the first stroke', async () => {
    await seatImage('img-1');

    strokeAt('img-1', [1, 1, 0]);

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toHaveLength(1);
    const [maskId] = segmentation.order;
    const { segmentId } = segmentation.masks[maskId];
    expect(useSegmentStore().segments.appearanceOf(segmentId).name).toBe(
      'Segment 1'
    );
    expect(useSegmentStore().segments.selectedSegmentId.value).toBe(segmentId);
    const binding = bindingOf(maskId)!;
    expect(maskValueAt(maskId, [1, 1, 0])).toBe(binding.labelValue);
  });

  it('erases only the active segment’s voxels', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    const paintStore = usePaintToolStore();

    paintAndLock(neighbor.id);
    selectSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    lockSegment(neighbor.id, false);

    paintStore.setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);

    const neighborBinding = bindingOf(neighbor.id)!;
    expect(maskValueAt(neighbor.id, [1, 1, 0])).toBe(
      neighborBinding.labelValue
    );
    expect(markedVoxels(active.id)).toEqual([]);
  });

  it('does not erase a foreign label value from the active buffer', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const foreign = boundSegment(segmentation.id, 'Foreign');
    const active = boundSegment(segmentation.id, 'Tumor');
    selectSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    const foreignValue = bindingOf(foreign.id)!.labelValue;
    store().maskVoxels(active.id).scalars()[offsetOf(active.id, [1, 1, 0])!] =
      foreignValue;

    usePaintToolStore().setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);

    expect(maskValueAt(active.id, [1, 1, 0])).toBe(foreignValue);
  });

  it('blocks a stroke when the active segment is locked', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    lockSegment(active.id, true);
    selectSegment(active.id);

    strokeAt('img-1', [1, 1, 0]);

    expect(markedVoxels(active.id)).toEqual([]);
  });

  it('paints past a locked neighbour without overwriting it', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');

    paintAndLock(neighbor.id);

    selectSegment(active.id);
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
    expect(store().maskLayersForImage('img-1')).toEqual([]);
  });
});
