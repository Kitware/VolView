import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT } from '@/src/config';
import { rgbaToCssColor } from '@/src/types/segmentation';

const IMAGE_ID = 'img-1';

const segments = () => useSegmentStore().segments;

const seatAndView = (id: string) => {
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });
  useViewStore().setDataForAllViews(id);
  return useSegmentationStore().ensureSegmentationForImage(id);
};

const recordsOf = (imageId: string) =>
  useSegmentationStore().getSegmentationForImage(imageId)!.order;

/** A polygon store holding one red 'Tumor' type, not yet placed. */
const colouredSegment = () => ({
  store: usePolygonStore(),
  segmentId: segments().addSegment({ name: 'Tumor', color: [214, 0, 0, 255] }),
});

/** One placed shape referencing a 'Tumor' type, serialized to the wire. */
const serializedToolForSegment = () => {
  const store = usePolygonStore();
  const segmentId = segments().addSegment({ name: 'Tumor' });
  store.addTool({ imageID: IMAGE_ID, placing: false, segmentId });
  return {
    store,
    segmentId,
    serialized: JSON.parse(JSON.stringify(store.serializeTools())),
  };
};

describe('shape references to segment segments', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  it('lists every type in the shared registry, content or not', () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    expect(store.segments.segmentList.value.map((type) => type.id)).toEqual([
      segmentId,
    ]);
    expect(store.segments.appearanceOf(segmentId).name).toBe('Tumor');
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('keeps the selected type when the viewed image changes', async () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    seatAndView('img-2');
    await nextTick();

    expect(store.segments.selectedSegmentId.value).toBe(segmentId);
    const id = store.addTool({ imageID: 'img-2', placing: false });
    expect(store.toolByID[id].segmentId).toBe(segmentId);
  });

  it('captures the selected type when a tool is added', () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const id = store.addTool({ imageID: IMAGE_ID, placing: false });

    expect(store.toolByID[id].segmentId).toBe(segmentId);
  });

  it('resolves the type name and color for the tool', () => {
    const { store, segmentId } = colouredSegment();

    const id = store.addTool({ imageID: IMAGE_ID, placing: false, segmentId });

    expect(store.appearanceOfTool(id).name).toBe('Tumor');
    expect(store.appearanceOfTool(id).cssColor).toBe(
      rgbaToCssColor([214, 0, 0, 255])
    );
    expect(store.appearanceOfTool(id).strokeWidth).toBe(
      STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT
    );
  });

  it('shows a rename without rewriting the tool', () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });
    const id = store.addTool({ imageID: IMAGE_ID, placing: false, segmentId });
    const before = store.toolByID[id];

    segments().updateSegment(segmentId, { name: 'Lesion' });

    expect(store.appearanceOfTool(id).name).toBe('Lesion');
    expect(store.toolByID[id]).toBe(before);
    expect(store.toolByID[id].segmentId).toBe(segmentId);
  });

  it('shows a recolor through the resolver', () => {
    const { store, segmentId } = colouredSegment();
    const id = store.addTool({ imageID: IMAGE_ID, placing: false, segmentId });

    segments().updateSegment(segmentId, { color: [0, 0, 255, 255] });

    expect(store.appearanceOfTool(id).cssColor).toBe(
      rgbaToCssColor([0, 0, 255, 255])
    );
  });

  it('shares one registry between polygons and rectangles', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const segmentId = polygons.segments.addSegment({ name: 'Tumor' });

    expect(rectangles.segments.getSegment(segmentId)?.name).toBe('Tumor');
    expect(rectangles.segments.selectedSegmentId.value).toBe(segmentId);
  });

  it('lets several shapes reference one type', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const first = polygons.addTool({ imageID: IMAGE_ID, placing: false });
    const second = polygons.addTool({ imageID: IMAGE_ID, placing: false });
    const third = rectangles.addTool({ imageID: IMAGE_ID, placing: false });

    expect(polygons.toolByID[first].segmentId).toBe(segmentId);
    expect(polygons.toolByID[second].segmentId).toBe(segmentId);
    expect(rectangles.toolByID[third].segmentId).toBe(segmentId);
    expect(first).not.toBe(second);
  });

  it('keeps the rectangle fill color a per-shape prop', () => {
    const rectangles = useRectangleStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const id = rectangles.addTool({ imageID: IMAGE_ID, placing: false });

    expect(rectangles.toolByID[id].fillColor).toBe('transparent');
    expect(segments().getSegment(segmentId)).not.toHaveProperty('fillColor');
  });

  it('allocates no voxels and no geometry for a type', () => {
    const store = usePolygonStore();

    segments().addSegment({ name: 'Tumor' });

    expect(recordsOf(IMAGE_ID)).toEqual([]);
    expect(useSegmentationStore().artifactMeta).toEqual({});
    expect(store.toolIDs).toEqual([]);
  });

  it('restores a shape whose type did not come back as unlabeled', () => {
    const { segmentId, serialized } = serializedToolForSegment();
    expect(serialized.tools[0].segmentId).toBe(segmentId);

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID });

    expect(restored.toolByID[restored.toolIDs[0]].segmentId).toBe('');
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('remaps a restored shape onto the type the registry adopted', () => {
    const { segmentId, serialized } = serializedToolForSegment();

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    const adopted = segments().adopt([
      {
        id: segmentId,
        name: 'Tumor',
        color: [1, 2, 3, 255],
        visible: true,
        locked: false,
      },
    ]);
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID }, adopted);

    const tool = restored.toolByID[restored.toolIDs[0]];
    expect(tool.segmentId).toBe(adopted[segmentId]);
    expect(restored.appearanceOfTool(tool.id).name).toBe('Tumor');
  });
});

describe('placing an annotation names its type', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  const place = (store: ReturnType<typeof useRectangleStore>) => {
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);
    return id;
  };

  it('mints a type for an annotation placed against nothing', () => {
    const store = useRectangleStore();
    expect(store.segments.selectedSegmentId.value).toBeUndefined();

    const id = place(store);

    const segmentId = store.toolByID[id].segmentId!;
    expect(segments().getSegment(segmentId)).toBeDefined();
    expect(store.appearanceOfTool(id).name).toBe('Segment 1');
    // Geometry only: the mask waits for an edit that writes voxels.
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('mints the type while the annotation is still being placed', () => {
    const store = useRectangleStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolType(id);

    expect(store.toolByID[id].placing).toBe(true);
    expect(segments().getSegment(store.toolByID[id].segmentId!)).toBeDefined();
  });

  it('mints once however many gestures the placement takes', () => {
    const store = usePolygonStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolType(id);
    store.resolveToolType(id);
    store.placeTool(id);

    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('leaves the placed type selected so the next one reuses it', () => {
    const store = useRectangleStore();

    const first = place(store);
    const second = place(store);

    expect(store.toolByID[second].segmentId).toBe(
      store.toolByID[first].segmentId
    );
    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('hands the minted type to the other delineation tools', () => {
    const rectangles = useRectangleStore();
    const polygons = usePolygonStore();

    const id = place(rectangles);
    const segmentId = rectangles.toolByID[id].segmentId!;

    expect(polygons.segments.getSegment(segmentId)).toBeDefined();
    expect(polygons.segments.selectedSegmentId.value).toBe(segmentId);
    // Paint resolves the same type into this image's mask.
    expect(
      useSegmentationStore().getMask(
        useSegmentationStore().resolveEditTarget(IMAGE_ID)
      ).segmentId
    ).toBe(segmentId);
  });

  it('places against the selected type rather than minting beside it', () => {
    const store = useRectangleStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const id = place(store);

    expect(store.toolByID[id].segmentId).toBe(segmentId);
    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('keeps the stub a widget is placing into when its segment is deleted', () => {
    const store = useRulerStore();
    const segmentId = store.segments.addSegment({ name: 'Long axis' });
    const stub = store.addTool({ imageID: IMAGE_ID, placing: true, segmentId });
    const placed = store.addTool({ imageID: IMAGE_ID, segmentId });

    store.segments.deleteSegment(segmentId);

    // The placed ruler goes with its segment; the stub the widget still holds
    // stays, and naming it is deferred to the placement that commits it.
    expect(store.toolByID[placed]).toBeUndefined();
    expect(store.toolByID[stub].placing).toBe(true);

    store.placeTool(stub);

    expect(
      store.segments.getSegment(store.toolByID[stub].segmentId!)
    ).toBeDefined();
  });

  it('does not count a stub as a reference that keeps a segment alive', () => {
    const store = useRulerStore();
    const segmentId = store.segments.addSegment({ name: 'Long axis' });
    store.addTool({ imageID: IMAGE_ID, placing: true, segmentId });

    expect(store.hasToolsOfSegment(segmentId)).toBe(false);

    const placed = store.addTool({ imageID: IMAGE_ID, segmentId });

    expect(store.hasToolsOfSegment(segmentId)).toBe(true);
    store.removeTool(placed);
    expect(store.hasToolsOfSegment(segmentId)).toBe(false);
  });

  it('places a ruler in the shared registry, painting nothing', () => {
    const store = useRulerStore();

    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);

    expect(store.toolByID[id].placing).toBe(false);
    // A ruler names a segment like any other annotation, and marks no voxels.
    expect(segments().getSegment(store.toolByID[id].segmentId!)).toBeDefined();
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });
});
