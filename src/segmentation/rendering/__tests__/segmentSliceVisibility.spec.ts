import { describe, expect, it } from 'vitest';

import {
  segmentCoincidentOffset,
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
// `segmentCoincidentOffset` gives each segment its own coincident-topology
// polygon offset, by its back-to-front stack index. Overlap is
// representable, so segments sharing one offset would z-fight.
// Greater stack indices draw in front. Registry order is mapped in reverse.
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

describe('segmentCoincidentOffset', () => {
  it('puts the first segment in front of the base image', () => {
    const [factor, units] = segmentCoincidentOffset(0);

    expect(factor).toBeLessThan(0);
    expect(units).toBeLessThan(0);
  });

  it('puts a greater stack index in front of a smaller one', () => {
    const [earlierFactor, earlierUnits] = segmentCoincidentOffset(0);
    const [laterFactor, laterUnits] = segmentCoincidentOffset(1);

    expect(laterUnits).toBeLessThan(earlierUnits);
    expect(laterFactor).toBeLessThanOrEqual(earlierFactor);
  });

  it('keeps that order all the way down a long list', () => {
    const offsets = Array.from({ length: 64 }, (_, index) =>
      segmentCoincidentOffset(index)
    );

    expect(
      offsets.every(
        ([factor, units]) => Number.isFinite(factor) && Number.isFinite(units)
      )
    ).toBe(true);
    offsets.slice(1).forEach(([, units], index) => {
      expect(units).toBeLessThan(offsets[index][1]);
    });
  });
});
