import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { TOOL_COLORS } from '@/src/config';
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

    expect(Object.keys(store.labels)).toEqual([segment.id]);
    expect(Object.values(store.labels).map((label) => label.labelName)).toEqual(
      ['Tumor']
    );
  });

  it('does not label a tool with a segment from another image', async () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');
    store.setActiveLabel(segment.id);
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
    store.setActiveLabel(segment.id);

    const id = store.addTool({ imageID: IMAGE_ID, placing: false });

    expect(store.activeLabel).toBe(segment.id);
    expect(store.toolByID[id].label).toBe(segment.id);
  });

  it('shows the segment name and color on the tool', () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor', [214, 0, 0, 255]);
    store.setActiveLabel(segment.id);

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
    const segment = makeSegment('Tumor');
    store.setActiveLabel(segment.id);
    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    useSegmentationStore().updateSegment(segment.id, {
      name: 'Lesion',
    });
    await nextTick();

    expect(store.toolByID[id].labelName).toBe('Lesion');
  });

  it('updates a tool’s color when the segment is recolored', async () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor', [214, 0, 0, 255]);
    store.setActiveLabel(segment.id);
    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });

    useSegmentationStore().updateSegment(segment.id, {
      color: [0, 0, 255, 255],
    });
    await nextTick();

    expect(store.toolByID[id].color).toBe(rgbaToCssColor([0, 0, 255, 255]));
  });

  it('leaves a tool untouched by a segment change its label does not show', async () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');
    store.setActiveLabel(segment.id);
    const id = store.addTool({
      imageID: IMAGE_ID,
      placing: false,
      label: segment.id,
    });
    const before = store.toolByID[id];

    useSegmentationStore().updateSegment(segment.id, { visible: false });
    await nextTick();

    expect(store.toolByID[id]).toBe(before);
  });

  it('shares one segment catalog between polygons and rectangles', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const segment = makeSegment('Tumor');

    expect(Object.keys(polygons.labels)).toEqual([segment.id]);
    expect(Object.keys(rectangles.labels)).toEqual([segment.id]);
  });

  it('keeps per-tool props out of the shared segment', () => {
    const rectangles = useRectangleStore();
    const segment = makeSegment('Tumor');
    rectangles.setActiveLabel(segment.id);

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

    const id = store.resolveLabelForImage(
      IMAGE_ID,
      store.addLabel({ labelName: 'Tumor' })
    )!;

    const segmentation =
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!;
    expect(segmentation.order).toEqual([id]);
    expect(segmentation.segments[id].name).toBe('Tumor');
  });

  it('restores a tool whose segment was deleted as unlabeled', () => {
    const store = usePolygonStore();
    const segment = makeSegment('Tumor');
    store.setActiveLabel(segment.id);
    store.addTool({ imageID: IMAGE_ID, placing: false, label: segment.id });
    useSegmentationStore().deleteSegment(segment.id);

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

    expect(store.labels).toEqual({});
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toEqual([]);
  });
});

describe('placing an annotation resolves its segment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  const place = (store: ReturnType<typeof useRectangleStore>) => {
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);
    return id;
  };

  it('mints a segment for an annotation placed against nothing', () => {
    const store = useRectangleStore();
    expect(store.activeLabel).toBeUndefined();

    const id = place(store);

    const segmentation = useSegmentationStore().getSegmentationForImage(
      IMAGE_ID
    )!;
    const [segmentId] = segmentation.order;
    expect(segmentId).toBeTruthy();
    expect(store.toolByID[id].label).toBe(segmentId);
    expect(store.toolByID[id].labelName).toBe(
      segmentation.segments[segmentId].name
    );
    expect(store.toolByID[id].color).toBe(
      rgbaToCssColor(segmentation.segments[segmentId].color)
    );
  });

  it('mints the segment while the annotation is still being placed', () => {
    const store = useRectangleStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolLabel(id);

    const segmentation = useSegmentationStore().getSegmentationForImage(
      IMAGE_ID
    )!;
    const [segmentId] = segmentation.order;
    expect(store.toolByID[id].placing).toBe(true);
    expect(store.toolByID[id].label).toBe(segmentId);
    expect(store.toolByID[id].color).toBe(
      rgbaToCssColor(segmentation.segments[segmentId].color)
    );
  });

  it('mints once however many gestures the placement takes', () => {
    const store = usePolygonStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolLabel(id);
    store.resolveToolLabel(id);
    store.placeTool(id);

    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toHaveLength(1);
  });

  it('resolves a ruler being placed without touching the segmentation', () => {
    const store = useRulerStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolLabel(id);

    expect(store.toolByID[id].color).toBe(TOOL_COLORS[0]);
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toEqual([]);
  });

  it('leaves the placed annotation selected so the next one reuses it', () => {
    const store = useRectangleStore();

    const first = place(store);
    const second = place(store);

    expect(store.toolByID[second].label).toBe(store.toolByID[first].label);
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toHaveLength(1);
  });

  it('hands the minted segment to the other delineation tools', () => {
    const rectangles = useRectangleStore();
    const polygons = usePolygonStore();

    const id = place(rectangles);
    const label = rectangles.toolByID[id].label!;

    expect(polygons.labels[label]).toBeTruthy();
    expect(polygons.activeLabel).toBe(label);
    // Paint reads the same target off the segmentation store.
    expect(useSegmentationStore().activeSegmentId).toBe(label);
  });

  it('materializes the selected template rather than minting beside it', () => {
    const store = useRectangleStore();
    store.addLabel({ labelName: 'Tumor', color: '#00ff00ff' });

    const id = place(store);

    const segmentation = useSegmentationStore().getSegmentationForImage(
      IMAGE_ID
    )!;
    expect(segmentation.order).toEqual([store.toolByID[id].label]);
    expect(segmentation.segments[segmentation.order[0]].name).toBe('Tumor');
  });

  it('places a ruler without touching the segmentation', () => {
    const store = useRulerStore();

    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);

    expect(store.toolByID[id].placing).toBe(false);
    expect(
      useSegmentationStore().getSegmentationForImage(IMAGE_ID)!.order
    ).toEqual([]);
  });
});
