import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Vector3 } from '@kitware/vtk.js/types';

import { rasterizePolygon } from '@/src/components/tools/polygon/rasterizeTarget';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { listSegments } from '@/src/types/segmentation';
import {
  addSegment,
  extentOf,
  labelValueOf,
  maskValueAt,
  seatImage,
  seedVoxel,
  store,
  type Index3,
} from '@/src/store/__tests__/segmentMaskFixtures';

// ---------------------------------------------------------------------------
// Rasterizing a polygon into a bounded mask. The write lives outside
// PolygonTool.vue so it can be tested: the component owns the view, not the
// voxels. The mask grows to hold the polygon before `fillPoly` runs (a mask
// that does not reach the polygon silently swallows every pixel), and the
// filled voxels are cleared in the other segments of the image.
//
// Unit spacing and a zero origin make world points index points, and an
// identity direction maps the Axial view axis to K.
// ---------------------------------------------------------------------------

const DIMENSIONS: Index3 = [6, 6, 2];

// fillPoly fills i in 1..4 and j in 2..4 for this square.
const SQUARE: Vector3[] = [
  [1, 1, 0],
  [4, 1, 0],
  [4, 4, 0],
  [1, 4, 0],
];

const rasterize = (segmentId: string | undefined, points = SQUARE, slice = 0) =>
  rasterizePolygon({
    imageId: 'img-1',
    segmentId,
    points,
    slice,
    viewAxis: 'Axial',
  });

const templateIdNamed = (
  labels: Record<string, { labelName?: string }>,
  name: string
) => Object.entries(labels).find(([, label]) => label.labelName === name)![0];

const segmentNamesOf = (imageId: string) =>
  listSegments(store().getSegmentationForImage(imageId)!).map(
    (segment) => segment.name
  );

describe('rasterizing a polygon into a bounded mask', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1', { dimensions: DIMENSIONS });
  });

  it('grows the mask to hold the polygon and fills it', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterize(segmentId);

    const labelValue = labelValueOf(segmentId);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(segmentId, [3, 3, 0])).toBe(labelValue);
    const extent = extentOf(segmentId)!;
    expect(extent[0]).toBeLessThanOrEqual(1);
    expect(extent[1]).toBeGreaterThanOrEqual(4);
    expect(extent[3]).toBeGreaterThanOrEqual(4);
    // One slice was drawn on, so one slice is covered.
    expect([extent[4], extent[5]]).toEqual([0, 0]);
  });

  it('leaves everything outside the polygon alone', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterize(segmentId);

    expect(maskValueAt(segmentId, [0, 0, 0])).toBeFalsy();
    expect(maskValueAt(segmentId, [5, 5, 0])).toBeFalsy();
    expect(maskValueAt(segmentId, [2, 3, 1])).toBeFalsy();
  });

  it('clears the filled voxels in another segment’s mask', () => {
    const neighbor = addSegment('img-1', 'Neighbour');
    seedVoxel(neighbor, [2, 3, 0]);
    seedVoxel(neighbor, [0, 0, 0]);
    const segmentId = addSegment('img-1', 'Tumor');

    rasterize(segmentId);

    expect(maskValueAt(neighbor, [2, 3, 0])).toBe(0);
    expect(maskValueAt(neighbor, [0, 0, 0])).toBe(labelValueOf(neighbor));
  });

  it('keeps an earlier polygon when a later one grows the mask', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    rasterize(segmentId);
    rasterize(
      segmentId,
      [
        [1, 1, 1],
        [4, 1, 1],
        [4, 4, 1],
        [1, 4, 1],
      ],
      1
    );

    const labelValue = labelValueOf(segmentId);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValue);
    expect(maskValueAt(segmentId, [2, 3, 1])).toBe(labelValue);
  });

  it('stays inside the parent image for a polygon that overhangs it', () => {
    const segmentId = addSegment('img-1', 'Tumor');

    expect(() =>
      rasterize(segmentId, [
        [-2, -2, 0],
        [2, -2, 0],
        [2, 2, 0],
        [-2, 2, 0],
      ])
    ).not.toThrow();

    const extent = extentOf(segmentId)!;
    expect(extent[0]).toBe(0);
    expect(extent[2]).toBe(0);
    expect(maskValueAt(segmentId, [1, 1, 0])).toBe(labelValueOf(segmentId));
  });

  it('rasterizes into a segment it resolves when the polygon carries none', () => {
    const { segmentId } = rasterize(undefined);

    const segmentation = store().getSegmentationForImage('img-1')!;
    expect(segmentation.order).toEqual([segmentId]);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValueOf(segmentId));
  });

  it('rasterizes into the template the polygon names, not the selected one', () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' }, Node: {} });
    const tumor = templateIdNamed(polygons.allLabels, 'Tumor');
    polygons.setActiveLabel(tumor);
    // The user picks another label between placing the polygon and rasterizing
    // it; the polygon still carries the template it was drawn with.
    polygons.setActiveLabel(templateIdNamed(polygons.allLabels, 'Node'));

    const { segmentId } = rasterize(tumor);

    expect(store().getSegment(segmentId).name).toBe('Tumor');
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
    expect(maskValueAt(segmentId, [2, 3, 0])).toBe(labelValueOf(segmentId));
  });

  it('rasterizes into the segment a template already became', () => {
    const polygons = usePolygonStore();
    polygons.mergeLabels({ Tumor: { color: '#00ff00' } });
    const tumor = templateIdNamed(polygons.allLabels, 'Tumor');

    const first = rasterize(tumor);
    const second = rasterize(tumor, SQUARE, 1);

    expect(second.segmentId).toBe(first.segmentId);
    expect(segmentNamesOf('img-1')).toEqual(['Tumor']);
  });

  it('rasterizes into the segment it was given, not the active one', () => {
    const active = addSegment('img-1', 'Active');
    store().setActiveSegment(active);
    const named = addSegment('img-1', 'Named');

    const result = rasterize(named);

    expect(result.segmentId).toBe(named);
    expect(maskValueAt(named, [2, 3, 0])).toBe(labelValueOf(named));
    expect(maskValueAt(active, [2, 3, 0])).toBeFalsy();
  });
});
