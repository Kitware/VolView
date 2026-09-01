import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useViewStore } from '@/src/store/views';
import { rgbaToCssColor } from '@/src/types/segmentation';

const IMAGE_ID = 'img-1';

const seatAndView = (id: string) => {
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });
  useViewStore().setDataForAllViews(id);
  return useSegmentationStore().ensureSegmentationForImage(id);
};

const makeSegment = (name: string, color?: [number, number, number, number]) =>
  useSegmentationStore().createSegment(
    useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.id,
    { name, ...(color ? { color } : {}) }
  );

describe('shared segment identity for polygons and rectangles', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  it('lists the viewed image’s segments', () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');

    expect(store.segments.map((entry) => entry.id)).toEqual([segment.id]);
    expect(store.segments.map((entry) => entry.name)).toEqual(['Tumor']);
  });

  it('does not label a tool with a segment from another image', async () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');
    store.setActiveSegment(segment.id);
    expect(store.activeLabel).toBe(segment.id);

    seatAndView('img-2');
    await nextTick();

    // The segment still belongs to img-1, so it must not label a tool placed
    // on img-2.
    expect(store.activeLabel).toBeUndefined();
    const id = store.addTool({ imageID: 'img-2', placing: false });
    expect(store.toolByID[id].label).toBeFalsy();
  });

  it('captures the active segment id when a tool is added', () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');
    store.setActiveSegment(segment.id);

    const id = store.addTool({ imageID: IMAGE_ID, placing: false });

    expect(store.activeSegmentId).toBe(segment.id);
    expect(store.toolByID[id].label).toBe(segment.id);
  });

  it('shows the segment name and color on the tool', () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor', [214, 0, 0, 255]);
    store.setActiveSegment(segment.id);

    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    expect(store.toolByID[id].labelName).toBe('Tumor');
    expect(store.toolByID[id].color).toBe(rgbaToCssColor([214, 0, 0, 255]));
  });

  it('updates a tool’s displayed name when the segment is renamed', async () => {
    const store = usePolygonStore();
    const segmentation =
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!;
    const segment = makeSegment('Tumor');
    store.setActiveSegment(segment.id);
    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    useSegmentationStore().updateSegment(segmentation.id, segment.id, {
      name: 'Lesion',
    });
    await nextTick();

    expect(store.toolByID[id].labelName).toBe('Lesion');
  });

  it('updates a tool’s color when the segment is recolored', async () => {
    const store = usePolygonStore();
    const segmentation =
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!;
    const segment = makeSegment('Tumor', [214, 0, 0, 255]);
    store.setActiveSegment(segment.id);
    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    useSegmentationStore().updateSegment(segmentation.id, segment.id, {
      color: [0, 0, 255, 255],
    });
    await nextTick();

    expect(store.toolByID[id].color).toBe(rgbaToCssColor([0, 0, 255, 255]));
  });

  it('shares one segment catalog between polygons and rectangles', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const segment = makeSegment('Tumor');

    expect(polygons.segments.map((entry) => entry.id)).toEqual([segment.id]);
    expect(rectangles.segments.map((entry) => entry.id)).toEqual([segment.id]);
  });

  it('keeps per-tool props out of the shared segment', () => {
    const rectangles = useRectangleStore();
    const segment = makeSegment('Tumor');
    rectangles.setActiveSegment(segment.id);

    const id = rectangles.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    expect(rectangles.toolByID[id].fillColor).toBe('transparent');
    expect(segment).not.toHaveProperty('fillColor');
  });

  it('serializes props for a segment no tool references yet', () => {
    const rectangles = useRectangleStore();
    const segment = makeSegment('Tumor');
    rectangles.updateLabel(segment.id, { fillColor: 'red' });

    const serialized = rectangles.serializeTools();

    expect(serialized.segmentProps?.[segment.id]).toMatchObject({
      fillColor: 'red',
    });
  });

  it('creates a segment in the segmentation store through the tool store', () => {
    const store = usePolygonStore();

    const id = store.createSegment({ name: 'Tumor' });

    const segmentation =
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!;
    expect(segmentation.order).toEqual([id]);
    expect(segmentation.segments[id].name).toBe('Tumor');
  });

  it('restores a tool whose segment was deleted as unlabeled', () => {
    const store = usePolygonStore();
    const segmentation =
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!;
    const segment = makeSegment('Tumor');
    store.setActiveSegment(segment.id);
    store.addTool({ imageID: IMAGE_ID, placing: false, label: segment.id });
    useSegmentationStore().deleteSegment(segmentation.id, segment.id);

    const serialized = JSON.parse(JSON.stringify(store.serializeTools()));
    expect(serialized.tools[0].label).toBe(segment.id);
    expect(serialized.segmentProps).toEqual({});

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID });

    expect(restored.toolByID[restored.toolIDs[0]].label).toBe('');
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toEqual([]);
  });

  it('pre-creates no segments for an empty segmentation', () => {
    const store = usePolygonStore();

    expect(store.segments).toEqual([]);
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toEqual([]);
  });
});
