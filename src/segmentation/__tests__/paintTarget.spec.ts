import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaintMode } from '@/src/core/tools/paint';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  activateAppPinia,
  bindingOf,
  seatSpecImage,
  markedVoxels,
  maskValueAt,
  offsetOf,
  selectSegment,
  mintSegment,
  lockSegment,
  store,
  strokeAt,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

function boundSegment(imageId: string, name: string) {
  const segmentId = mintSegment(imageId, { name });
  store().materializeMask(segmentId);
  return segmentId;
}

function paintAndLock(segmentId: string) {
  selectSegment(segmentId);
  strokeAt('img-1', [1, 1, 0]);
  lockSegment(segmentId, true);
}

describe('paint edit target', () => {
  beforeEach(() => {
    activateAppPinia();
  });

  it("writes SEGMENT_VALUE into the selected segment's mask", async () => {
    await seatSpecImage('img-1');
    boundSegment('img-1', 'Other');
    const active = boundSegment('img-1', 'Tumor');
    selectSegment(active);

    strokeAt('img-1', [1, 1, 0]);

    expect(bindingOf(active)).toBeDefined();
    expect(maskValueAt(active, [1, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it("writes into the painted image's own mask", async () => {
    await seatSpecImage('img-1');
    await seatSpecImage('img-2');
    const source = boundSegment('img-1', 'Tumor');
    selectSegment(source);

    strokeAt('img-2', [1, 1, 0]);

    const painted = store().findEditTarget('img-2')!;
    expect(painted).not.toBe(source);
    const paintedBinding = bindingOf(painted)!;
    const sourceBinding = bindingOf(source)!;
    expect(paintedBinding.image).not.toBe(sourceBinding.image);
    expect(maskValueAt(painted, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(markedVoxels(source)).toEqual([]);
  });

  it('seeds a segment and its mask on the first stroke', async () => {
    await seatSpecImage('img-1');

    strokeAt('img-1', [1, 1, 0]);

    const masks = store().imageMasks('img-1');
    expect(masks).toHaveLength(1);
    const [{ segmentId }] = masks;
    expect(useSegmentStore().segments.appearanceOf(segmentId).name).toBe(
      'Segment 1'
    );
    expect(useSegmentStore().segments.selectedSegmentId('img-1')).toBe(
      segmentId
    );
    expect(maskValueAt(segmentId, [1, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it("erases only the active segment's voxels", async () => {
    await seatSpecImage('img-1');
    const neighbor = boundSegment('img-1', 'Neighbor');
    const active = boundSegment('img-1', 'Tumor');
    const paintStore = usePaintToolStore();

    selectSegment(neighbor);
    strokeAt('img-1', [1, 1, 0]);
    store().allowOverlap = true;
    selectSegment(active);
    strokeAt('img-1', [1, 1, 0]);
    expect(maskValueAt(active, [1, 1, 0])).toBe(SEGMENT_VALUE);

    paintStore.setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);
    expect(maskValueAt(neighbor, [1, 1, 0])).toBe(SEGMENT_VALUE);
    // Erased to nothing, so the active mask went with its voxels.
    expect(store().maskOf(active)).toBeUndefined();
  });

  // A mask holds SEGMENT_VALUE and nothing else, so any other byte in it is
  // not this segment's to clear.
  it('does not erase a foreign label value from the active buffer', async () => {
    await seatSpecImage('img-1');
    const active = boundSegment('img-1', 'Tumor');
    selectSegment(active);
    strokeAt('img-1', [1, 1, 0]);
    const foreignValue = SEGMENT_VALUE + 1;
    store().maskVoxels(active).scalars()[offsetOf(active, [1, 1, 0])!] =
      foreignValue;

    usePaintToolStore().setMode(PaintMode.Erase);
    strokeAt('img-1', [1, 1, 0]);

    expect(maskValueAt(active, [1, 1, 0])).toBe(foreignValue);
  });

  it('blocks a stroke when the active segment is locked', async () => {
    await seatSpecImage('img-1');
    boundSegment('img-1', 'Neighbor');
    const active = boundSegment('img-1', 'Tumor');
    lockSegment(active, true);
    selectSegment(active);

    strokeAt('img-1', [1, 1, 0]);

    expect(markedVoxels(active)).toEqual([]);
  });

  it('paints around a locked neighbor without overwriting it', async () => {
    await seatSpecImage('img-1');
    const neighbor = boundSegment('img-1', 'Neighbor');
    const active = boundSegment('img-1', 'Tumor');

    paintAndLock(neighbor);

    selectSegment(active);
    strokeAt('img-1', [1, 1, 0]);
    strokeAt('img-1', [3, 1, 0]);

    // The first stroke painted nothing and left no mask, so the second one
    // minted the mask the segment has now.
    expect(bindingOf(active)).toBeDefined();
    expect(maskValueAt(neighbor, [1, 1, 0])).toBe(SEGMENT_VALUE);
    expect(maskValueAt(active, [1, 1, 0])).toBeFalsy();
    expect(maskValueAt(active, [3, 1, 0])).toBe(SEGMENT_VALUE);
  });

  it('creates nothing when the paint tool is merely activated', async () => {
    await seatSpecImage('img-1');
    const paintStore = usePaintToolStore();

    paintStore.activateTool();

    expect(useSegmentStore().segments.segmentList('img-1')).toEqual([]);
    expect(store().imageMasks('img-1')).toEqual([]);
  });

  it.each([false, true])(
    'publishes overwritten voxels at the end of a paint sample (throws: %s)',
    async (throws) => {
      await seatSpecImage('img-1');
      const neighbor = boundSegment('img-1', 'Neighbor');
      const voxels = store().maskVoxels(neighbor);
      voxels.ensureContains([0, 3, 0, 3, 0, 1]);
      voxels.scalars().fill(1);
      const modified = vi.fn();
      voxels.image().onModified(modified);
      const active = boundSegment('img-1', 'Active');
      selectSegment(active);
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
