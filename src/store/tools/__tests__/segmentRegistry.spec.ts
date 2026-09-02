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

const namesOf = (labels: Record<string, { labelName?: string }>) =>
  Object.values(labels).map((label) => label.labelName);

const colorsOf = (labels: Record<string, { color?: string }>) =>
  Object.values(labels).map((label) => label.color);

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

    expect(Object.keys(registry.labels.value)).toEqual([first.id, second.id]);
    expect(namesOf(registry.labels.value)).toEqual(['Tumor', 'Node']);
  });

  it('reports no segments for an image without a segmentation', () => {
    seatImage('img-1');
    viewImage('img-1');

    expect(createSharedSegmentRegistry().labels.value).toEqual({});
  });

  it('exposes segment colors as css strings for tool rendering', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
      color: [214, 0, 0, 255],
    });

    const registry = createSharedSegmentRegistry();

    expect(registry.labels.value[segment.id]?.color).toBe(
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

    expect(registry.labels.value[segment.id]?.labelName).toBe('Lesion');
    expect(namesOf(registry.labels.value)).toEqual(['Lesion']);
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

    expect(registry.labels.value[segment.id]?.color).toBe(
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

    expect(registry.labels.value).toEqual({});
  });

  it('seeds a segmentation when the viewed image has none', () => {
    seatImage('img-1');
    viewImage('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.materializeLabelForImage(
      'img-1',
      registry.addLabel({ labelName: 'Tumor' })
    );

    expect(segmentationStore().getSegmentationForImage('img-1')?.order).toEqual(
      [id]
    );
  });

  it('allocates no voxels when a label materializes', () => {
    const segmentation = seatAndView('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.materializeLabelForImage(
      'img-1',
      registry.addLabel({ labelName: 'Tumor' })
    )!;

    expect(segmentation.segments[id].representations.labelmap).toBeUndefined();
    expect(segmentationStore().segmentLayersForImage('img-1')).toEqual([]);
  });

  it('tracks the active segment', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    registry.setActiveLabel(segment.id);
    expect(registry.activeLabel.value).toBe(segment.id);

    registry.setActiveLabel(undefined);
    expect(registry.activeLabel.value).toBeFalsy();
  });

  it('takes the active segment from the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    segmentationStore().setActiveSegment(segment.id);

    expect(registry.activeLabel.value).toBe(segment.id);
  });

  it('records the segment it activates on the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const segment = segmentationStore().createSegment(segmentation.id, {
      name: 'Tumor',
    });
    const registry = createSharedSegmentRegistry();

    registry.setActiveLabel(segment.id);

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

    expect(Object.keys(registry.labels.value)).toEqual([other.id]);

    viewImage('img-1');

    expect(namesOf(registry.labels.value)).toEqual(['Tumor']);
  });

  it('declares a template rather than minting a segment', () => {
    const segmentation = seatAndView('img-1');
    const registry = createSharedSegmentRegistry();

    const id = registry.addLabel({ labelName: 'Lesion' });

    expect(segmentation.order).toEqual([]);
    expect(registry.allLabels.value[id]?.labelName).toBe('Lesion');
    // The picker binds activeLabel; the store holds no active segment because
    // none exists yet.
    expect(registry.activeLabel.value).toBe(id);
    expect(segmentationStore().activeSegmentId).toBeFalsy();
  });

  it('mints the declared template on the first edit that materializes it', () => {
    const segmentation = seatAndView('img-1');
    const registry = createSharedSegmentRegistry();
    const template = registry.addLabel({
      labelName: 'Lesion',
      color: '#00ff00ff',
    });

    const id = registry.materializeLabelForImage('img-1', template);

    expect(segmentation.order).toEqual([id]);
    expect(segmentation.segments[id!].name).toBe('Lesion');
    expect(segmentation.segments[id!].color).toEqual([0, 255, 0, 255]);
  });

  it('shares one segment catalog across registries on the same image', () => {
    seatAndView('img-1');
    const polygons = createSharedSegmentRegistry();
    const rectangles = createSharedSegmentRegistry();

    const id = polygons.materializeLabelForImage(
      'img-1',
      polygons.addLabel({ labelName: 'Tumor' })
    )!;

    expect(rectangles.labels.value[id]?.labelName).toBe('Tumor');
  });
});

describe('local segment registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('seeds the initial labels by name and color', () => {
    const registry = createLocalSegmentRegistry(RULER_LABEL_DEFAULTS);

    expect(namesOf(registry.labels.value)).toEqual(['Label 1']);
    expect(colorsOf(registry.labels.value)).toEqual(['red']);
  });

  it('activates the segment it creates', () => {
    const registry = createLocalSegmentRegistry({});

    const id = registry.addLabel({ labelName: 'Tumor' });

    expect(registry.activeLabel.value).toBe(id);
    expect(registry.labels.value[id]?.labelName).toBe('Tumor');
  });

  it('cycles the tool colors for created segments', () => {
    const registry = createLocalSegmentRegistry({});

    const ids = TOOL_COLORS.map(() => registry.addLabel());

    expect(ids.map((id) => registry.labels.value[id]?.color)).toEqual([
      ...TOOL_COLORS,
    ]);
  });

  it('honors an explicit color', () => {
    const registry = createLocalSegmentRegistry({});

    const id = registry.addLabel({ labelName: 'Tumor', color: 'red' });

    expect(registry.labels.value[id]?.color).toBe('red');
  });

  it('applies the new label defaults to created segments', () => {
    const registry = createLocalSegmentRegistry({}, { strokeWidth: 3 });

    const id = registry.addLabel();

    expect(registry.labels.value[id].strokeWidth).toBe(3);
  });

  it('renames through the label api', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.addLabel({ labelName: 'Tumor' });

    registry.updateLabel(id, { labelName: 'Lesion' });

    expect(registry.labels.value[id]?.labelName).toBe('Lesion');
  });

  it('recolors through the label api', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.addLabel({ labelName: 'Tumor' });

    registry.updateLabel(id, { color: 'red' });

    expect(registry.labels.value[id]?.color).toBe('red');
  });

  it('moves the active segment when the active one is deleted', () => {
    const registry = createLocalSegmentRegistry({});
    const kept = registry.addLabel({ labelName: 'Tumor' });
    const doomed = registry.addLabel({ labelName: 'Node' });

    registry.deleteLabel(doomed);

    expect(Object.keys(registry.labels.value)).toEqual([kept]);
    expect(registry.activeLabel.value).toBe(kept);
  });

  it('clears the active segment when the last one is deleted', () => {
    const registry = createLocalSegmentRegistry({});
    const id = registry.addLabel({ labelName: 'Tumor' });

    registry.deleteLabel(id);

    expect(registry.labels.value).toEqual({});
    expect(registry.activeLabel.value).toBeFalsy();
  });

  it('rejects deleting an unknown label', () => {
    const registry = createLocalSegmentRegistry({});

    expect(() => registry.deleteLabel('nope')).toThrow();
  });

  it('accepts an unset active segment', () => {
    const registry = createLocalSegmentRegistry({});
    registry.addLabel({ labelName: 'Tumor' });

    registry.setActiveLabel(undefined);

    expect(registry.activeLabel.value).toBeFalsy();
  });

  it('keeps its segments out of the segmentation store', () => {
    seatImage('img-1');
    viewImage('img-1');
    const registry = createLocalSegmentRegistry({});

    registry.addLabel({ labelName: 'Tumor' });

    expect(
      segmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });

  it('does not see segments created in the segmentation store', () => {
    const segmentation = seatAndView('img-1');
    const registry = createLocalSegmentRegistry({});

    segmentationStore().createSegment(segmentation.id, { name: 'Tumor' });

    expect(registry.labels.value).toEqual({});
  });
});
