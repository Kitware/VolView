import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { RULER_LABEL_DEFAULTS, TOOL_COLORS } from '@/src/config';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useViewStore } from '@/src/store/views';
import {
  createLocalSegmentRegistry,
  createSharedSegmentRegistry,
} from '@/src/store/tools/segmentRegistry';
import { rgbaToCssColor } from '@/src/types/segmentation';

const seatImage = (id: string, name = 'CT') =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), name, {
    id,
  });

const viewImage = (id: string) => useViewStore().setDataForAllViews(id);

const segmentationStore = () => useSegmentationStore();

/** Seats an image, points every view at it, and returns its segmentation. */
const seatAndView = (id: string) => {
  seatImage(id);
  viewImage(id);
  return segmentationStore().ensureSegmentationForImage(id);
};

describe('shared segment registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('lists the viewed image’s segments in segmentation order', () => {
    const segmentation = seatAndView('img-1');
    const first = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const second = segmentationStore().createSegment(segmentation.id, {
      name: 'Node',
    });

    const registry = createSharedSegmentRegistry();

    expect(registry.segments.value.map((segment) => segment.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(registry.segments.value.map((segment) => segment.name)).toEqual([
      'Tumor',
      'Node',
    ]);
  });

  it('reports no segments for an image without a segmentation', () => {
    seatImage('img-1');
    viewImage('img-1');

    expect(createSharedSegmentRegistry().segments.value).toEqual([]);
  });

  it('exposes segment colors as css strings for tool rendering', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
      color: [214, 0, 0, 255],
    });

    const registry = createSharedSegmentRegistry();

    expect(registry.getSegment(segment.id)?.color).toBe(
      rgbaToCssColor([214, 0, 0, 255])
    );
  });

  it('reflects a rename made through the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    segmentationStore().updateSegment(segment.id, {
      name: 'Lesion',
    });

    expect(registry.getSegment(segment.id)?.name).toBe('Lesion');
    expect(registry.segments.value.map((entry) => entry.name)).toEqual([
      'Lesion',
    ]);
  });

  it('reflects a recolor made through the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
      color: [214, 0, 0, 255],
    });
    const registry = createSharedSegmentRegistry();

    segmentationStore().updateSegment(segment.id, {
      color: [0, 0, 255, 255],
    });

    expect(registry.getSegment(segment.id)?.color).toBe(
      rgbaToCssColor([0, 0, 255, 255])
    );
  });

  it('drops a segment deleted through the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    segmentationStore().deleteSegment(segment.id);

    expect(registry.segments.value).toEqual([]);
    expect(registry.getSegment(segment.id)).toBeUndefined();
  });

  it('returns undefined for an unknown segment id', () => {
    seatAndView('img-1');

    expect(createSharedSegmentRegistry().getSegment('nope')).toBeUndefined();
  });

  it('creates segments in the viewed image’s segmentation', () => {
    const segmentation = seatAndView('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.createSegment({ name: 'Tumor', color: '#00ff00ff' });

    expect(segmentation.order).toEqual([id]);
    expect(segmentation.segments[id].name).toBe('Tumor');
    expect(segmentation.segments[id].color).toEqual([0, 255, 0, 255]);
  });

  it('seeds a segmentation when the viewed image has none', () => {
    seatImage('img-1');
    viewImage('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.createSegment();

    expect(segmentationStore().getSegmentationForImage('img-1')?.order).toEqual(
      [id]
    );
  });

  it('allocates no voxels when creating a segment', () => {
    const segmentation = seatAndView('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.createSegment({ name: 'Tumor' });

    expect(segmentation.segments[id].representations.labelmap).toBeUndefined();
    expect(segmentationStore().artifactsForImage('img-1')).toEqual([]);
  });

  it('tracks the active segment', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    registry.setActiveSegment(segment.id);
    expect(registry.activeSegmentId.value).toBe(segment.id);

    registry.setActiveSegment(undefined);
    expect(registry.activeSegmentId.value).toBeFalsy();
  });

  it('takes the active segment from the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    segmentationStore().setActiveSegment(segment.id);

    expect(registry.activeSegmentId.value).toBe(segment.id);
  });

  it('records the segment it activates on the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    registry.setActiveSegment(segment.id);

    expect(segmentationStore().activeSegmentId).toBe(segment.id);
  });

  it('scopes segments to the viewed image', () => {
    const first = seatAndView('img-1');
    segmentationStore().createSegment(first.id, { name: 'Tumor' });
    const second = seatAndView('img-2');
    const other = segmentationStore().createSegment(second.id, {
      name: 'Node',
    });
    const registry = createSharedSegmentRegistry();

    expect(registry.segments.value.map((segment) => segment.id)).toEqual([
      other.id,
    ]);

    viewImage('img-1');

    expect(registry.segments.value.map((segment) => segment.name)).toEqual([
      'Tumor',
    ]);
  });

  it('shares one segment catalog across registries on the same image', () => {
    seatAndView('img-1');
    const polygons = createSharedSegmentRegistry();
    const rectangles = createSharedSegmentRegistry();

    const id = polygons.createSegment({ name: 'Tumor' });

    expect(rectangles.getSegment(id)?.name).toBe('Tumor');
  });
});

describe('local segment registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('seeds the initial labels by name and color', () => {
    const registry = createLocalSegmentRegistry(RULER_LABEL_DEFAULTS);

    expect(registry.segments.value.map((segment) => segment.name)).toEqual([
      'Label 1',
    ]);
    expect(registry.segments.value.map((segment) => segment.color)).toEqual([
      'red',
    ]);
  });

  it('activates the segment it creates', () => {
    const registry = createLocalSegmentRegistry({});

    const id = registry.createSegment({ name: 'Tumor' });

    expect(registry.activeSegmentId.value).toBe(id);
    expect(registry.getSegment(id)?.name).toBe('Tumor');
  });

  it('cycles the tool colors for created segments', () => {
    const registry = createLocalSegmentRegistry({});

    const ids = TOOL_COLORS.map(() => registry.createSegment());

    expect(ids.map((id) => registry.getSegment(id)?.color)).toEqual([
      ...TOOL_COLORS,
    ]);
  });

  it('honors an explicit color', () => {
    const registry = createLocalSegmentRegistry({});

    const id = registry.createSegment({ name: 'Tumor', color: 'red' });

    expect(registry.getSegment(id)?.color).toBe('red');
  });

  it('applies the new label defaults to created segments', () => {
    const registry = createLocalSegmentRegistry({}, { strokeWidth: 3 });

    const id = registry.createSegment();

    expect(registry.labels.value[id].strokeWidth).toBe(3);
  });

  it('renames through the label api', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.createSegment({ name: 'Tumor' });

    registry.updateLabel(id, { labelName: 'Lesion' });

    expect(registry.getSegment(id)?.name).toBe('Lesion');
  });

  it('recolors through the label api', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.createSegment({ name: 'Tumor' });

    registry.updateLabel(id, { color: 'red' });

    expect(registry.getSegment(id)?.color).toBe('red');
  });

  it('moves the active segment when the active one is deleted', () => {
    const registry = createLocalSegmentRegistry({});
    const kept = registry.createSegment({ name: 'Tumor' });
    const doomed = registry.createSegment({ name: 'Node' });

    registry.deleteLabel(doomed);

    expect(registry.segments.value.map((segment) => segment.id)).toEqual([
      kept,
    ]);
    expect(registry.activeSegmentId.value).toBe(kept);
  });

  it('clears the active segment when the last one is deleted', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.createSegment({ name: 'Tumor' });

    registry.deleteLabel(id);

    expect(registry.segments.value).toEqual([]);
    expect(registry.activeSegmentId.value).toBeFalsy();
  });

  it('rejects deleting an unknown label', () => {
    const registry = createLocalSegmentRegistry({});

    expect(() => registry.deleteLabel('nope')).toThrow();
  });

  it('accepts an unset active segment', () => {
    const registry = createLocalSegmentRegistry({});
    registry.createSegment({ name: 'Tumor' });

    registry.setActiveSegment(undefined);

    expect(registry.activeSegmentId.value).toBeFalsy();
  });

  it('keeps its segments out of the segmentation store', () => {
    seatImage('img-1');
    viewImage('img-1');
    const registry = createLocalSegmentRegistry({});

    registry.createSegment({ name: 'Tumor' });

    expect(
      segmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });

  it('does not see segments created in the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const registry = createLocalSegmentRegistry({});

    segmentationStore().createSegment(segmentation.id, { name: 'Tumor' });

    expect(registry.segments.value).toEqual([]);
  });
});
