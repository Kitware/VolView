import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaintMode } from '@/src/core/tools/paint';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  activateAppPinia,
  bindingOf,
  seatSpecImage as seatImage,
  markedVoxels,
  maskValueAt,
  offsetOf,
  selectSegment,
  mintSegment,
  lockSegment,
  store,
  strokeAt,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

function boundSegment(segmentationId: string, name: string) {
  const segment = store().createMask(segmentationId, mintSegment({ name }));
  store().ensureLabelmapBinding(segment.id);
  return segment;
}

function paintAndLock(maskId: string) {
  selectSegment(maskId);
  strokeAt('img-1', [1, 1, 0]);
  lockSegment(maskId, true);
}

describe('paint edit target', () => {
  beforeEach(() => {
    activateAppPinia();
  });

  it("writes SEGMENT_VALUE into the selected segment's mask", async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    boundSegment(segmentation.id, 'Other');
    const active = boundSegment(segmentation.id, 'Tumor');
    selectSegment(active.id);

    strokeAt('img-1', [1, 1, 0]);

    expect(bindingOf(active.id)).toBeDefined();
    expect(maskValueAt(active.id, [1, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it("writes into the painted image's own mask", async () => {
    await seatImage('img-1');
    await seatImage('img-2');
    const first = store().ensureSegmentationForImage('img-1');
    const source = boundSegment(first.id, 'Tumor');
    selectSegment(source.id);

    strokeAt('img-2', [1, 1, 0]);

    // The segment is shared; this image gets its own record and its own mask.
    const painted = store().findEditTarget('img-2')!;
    expect(store().getMask(painted).segmentId).toBe(source.segmentId);
    const paintedBinding = bindingOf(painted)!;
    const sourceBinding = bindingOf(source.id)!;
    expect(paintedBinding.image).not.toBe(sourceBinding.image);
    expect(maskValueAt(painted, [1, 1, 0])).toBe(SEGMENT_VALUE);
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
    expect(maskValueAt(maskId, [1, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it("erases only the active segment's voxels", async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');
    const paintStore = usePaintToolStore();

    selectSegment(neighbor.id);
    strokeAt('img-1', [1, 1, 0]);
    store().allowOverlap = true;
    selectSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    expect(maskValueAt(active.id, [1, 1, 0])).toBe(SEGMENT_VALUE);

    paintStore.setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);
    expect(maskValueAt(neighbor.id, [1, 1, 0])).toBe(SEGMENT_VALUE);
    // Erased to nothing, so the active mask went with its voxels.
    expect(store().maskExists(active.id)).toBe(false);
  });

  // A mask holds SEGMENT_VALUE and nothing else, so any other byte in it is
  // not this segment's to clear.
  it('does not erase a foreign label value from the active buffer', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const active = boundSegment(segmentation.id, 'Tumor');
    selectSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    const foreignValue = SEGMENT_VALUE + 1;
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

  it('paints around a locked neighbor without overwriting it', async () => {
    await seatImage('img-1');
    const segmentation = store().ensureSegmentationForImage('img-1');
    const neighbor = boundSegment(segmentation.id, 'Neighbor');
    const active = boundSegment(segmentation.id, 'Tumor');

    paintAndLock(neighbor.id);

    selectSegment(active.id);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [3, 1, 0]);

    // The first stroke painted nothing and left no mask, so the second one
    // minted the mask the segment has now.
    const painted = store().maskFor('img-1', active.segmentId)!.id;
    expect(maskValueAt(neighbor.id, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(painted, [1, 1, 0])).toBeFalsy();
    expect(maskValueAt(painted, [3, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it('creates nothing when the paint tool is merely activated', async () => {
    await seatImage('img-1');
    const paintStore = usePaintToolStore();

    paintStore.activateTool();

    expect(store().getSegmentationForImage('img-1')).toBeUndefined();
    expect(store().boundMaskIds('img-1')).toEqual([]);
  });

  it.each([false, true])(
    'publishes overwritten voxels at the end of a paint sample (throws: %s)',
    async (throws) => {
      await seatImage('img-1');
      const segmentation = store().ensureSegmentationForImage('img-1');
      const neighbor = boundSegment(segmentation.id, 'Neighbor');
      const voxels = store().maskVoxels(neighbor.id);
      voxels.ensureContains([0, 3, 0, 3, 0, 1]);
      voxels.scalars().fill(1);
      const modified = vi.fn();
      voxels.image().onModified(modified);
      const active = boundSegment(segmentation.id, 'Active');
      selectSegment(active.id);
      const paint = usePaintToolStore();
      paint.setBrushSize(3);
      const paintLabelmap = paint.$paint.paintLabelmap.bind(paint.$paint);
      const intercepted = vi.spyOn(paint.$paint, 'paintLabelmap');
      intercepted.mockImplementation((image, axis, point, options) => {
        let written = 0;
        return paintLabelmap(image, axis, point, {
          ...options,
          shouldPaint: (offset, ijk) => {
            const paints = options?.shouldPaint?.(offset, ijk) ?? true;
            if (paints) written += 1;
            if (throws && written === 2) throw new Error('Interrupted stroke');
            return paints;
          },
        });
      });

      try {
        const stroke = () => paint.startStroke([1, 1, 0], 2, 'img-1');
        if (throws) expect(stroke).toThrow('Interrupted stroke');
        else stroke();
        expect(
          voxels.scalars().filter((value) => value === 0).length
        ).toBeGreaterThan(1);
        expect(modified).toHaveBeenCalledTimes(1);
      } finally {
        intercepted.mockRestore();
      }
    }
  );
});
