import { describe, expect, it } from 'vitest';

import {
  SEGMENT_COINCIDENT_OFFSET,
  sliceWithinExtent,
} from '@/src/segmentation/rendering/display';
import { emptyExtent, type Extent3D } from '@/src/segmentation/geometry';

// ---------------------------------------------------------------------------
// The two view-layer rules a mask per segment needs.
//
// `sliceWithinExtent` answers whether a segment's actor has anything to draw on
// the slice being viewed. A bounded mask covers only part of the volume, and
// vtkImageMapper clamps a slice outside its input to the nearest one, so an
// actor left visible off its own extent paints a stale slice over the image.
// The slice and the extent are both in the PARENT image's index space, on the
// index axis the view's LPS axis maps to.
//
// `SEGMENT_COINCIDENT_OFFSET` is the coincident-topology polygon offset every
// segment draws at, which lifts it off the coplanar base image. It carries no
// per-segment term: the actors are translucent, so the renderer blends the
// overlap rather than stacking it, and a per-segment offset would do nothing.
// ---------------------------------------------------------------------------

const EXTENT: Extent3D = [1, 2, 0, 3, 2, 5];

describe('sliceWithinExtent', () => {
  it('is true for a slice inside the extent', () => {
    expect(sliceWithinExtent(EXTENT, 2, 3)).toBe(true);
  });

  it('includes both ends of the extent', () => {
    expect(sliceWithinExtent(EXTENT, 2, 2)).toBe(true);
    expect(sliceWithinExtent(EXTENT, 2, 5)).toBe(true);
  });

  it('is false below the extent', () => {
    expect(sliceWithinExtent(EXTENT, 2, 1)).toBe(false);
  });

  it('is false above the extent', () => {
    expect(sliceWithinExtent(EXTENT, 2, 6)).toBe(false);
  });

  it('reads the axis it is given', () => {
    expect(sliceWithinExtent(EXTENT, 0, 3)).toBe(false);
    expect(sliceWithinExtent(EXTENT, 1, 3)).toBe(true);
  });

  it('is false for a mask that covers nothing, on every axis', () => {
    expect(sliceWithinExtent(emptyExtent(), 0, 0)).toBe(false);
    expect(sliceWithinExtent(emptyExtent(), 1, 0)).toBe(false);
    expect(sliceWithinExtent(emptyExtent(), 2, 0)).toBe(false);
  });
});

describe('SEGMENT_COINCIDENT_OFFSET', () => {
  it('puts a segment in front of the base image', () => {
    const [factor, units] = SEGMENT_COINCIDENT_OFFSET;

    expect(factor).toBeLessThan(0);
    expect(units).toBeLessThan(0);
  });

  it('is one offset, not a per-segment one', () => {
    expect(SEGMENT_COINCIDENT_OFFSET).toHaveLength(2);
    expect(
      SEGMENT_COINCIDENT_OFFSET.every((value) => Number.isFinite(value))
    ).toBe(true);
  });
});
