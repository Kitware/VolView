import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT } from '@/src/config';
import { rgbaToCssColor } from '@/src/segmentation/color';
import { boundMasks } from '@/src/segmentation/__tests__/segmentMaskFixtures';

const IMAGE_ID = 'img-1';

const segments = () => useSegmentStore().segments;

const seatAndView = (id: string) => {
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });
  useViewStore().setDataForAllViews(id);
};

const segmentationOf = (imageId: string) =>
  useSegmentationStore().getSegmentationForImage(imageId);

const coloredSegment = () => ({
  store: usePolygonStore(),
  segmentId: segments().addSegment({ name: 'Tumor', color: [214, 0, 0, 255] }),
});

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

describe('shape references to segments', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  it('lists every segment in the shared registry, content or not', () => {
    const segmentId = segments().addSegment({ name: 'Tumor' });

    expect(segments().segmentList.value.map((type) => type.id)).toEqual([
      segmentId,
    ]);
    expect(segments().appearanceOf(segmentId).name).toBe('Tumor');
    expect(segmentationOf(IMAGE_ID)).toBeUndefined();
  });

  it('keeps the selected segment when the viewed image changes', async () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    seatAndView('img-2');
    await nextTick();

    expect(segments().selectedSegmentId.value).toBe(segmentId);
    const id = store.addTool({ imageID: 'img-2', placing: false });
    expect(store.toolByID[id].segmentId).toBe(segmentId);
  });

  it('captures the selected segment when a tool is added', () => {
    const store = usePolygonStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const id = store.addTool({ imageID: IMAGE_ID, placing: false });

    expect(store.toolByID[id].segmentId).toBe(segmentId);
  });

  it('resolves the segment name and color for the tool', () => {
    const { store, segmentId } = coloredSegment();

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
    const { store, segmentId } = coloredSegment();
    const id = store.addTool({ imageID: IMAGE_ID, placing: false, segmentId });

    segments().updateSegment(segmentId, { color: [0, 0, 255, 255] });

    expect(store.appearanceOfTool(id).cssColor).toBe(
      rgbaToCssColor([0, 0, 255, 255])
    );
  });

  it('lets several shapes reference one segment', () => {
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

  it('allocates no voxels and no geometry for a segment', () => {
    const store = usePolygonStore();

    segments().addSegment({ name: 'Tumor' });

    expect(segmentationOf(IMAGE_ID)).toBeUndefined();
    expect(boundMasks()).toEqual([]);
    expect(store.toolIDs).toEqual([]);
  });

  it('restores a shape whose segment did not come back as unlabeled', () => {
    const { segmentId, serialized } = serializedToolForSegment();
    expect(serialized.tools[0].segmentId).toBe(segmentId);

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID });

    expect(restored.toolByID[restored.toolIDs[0]].segmentId).toBe('');
    expect(segmentationOf(IMAGE_ID)).toBeUndefined();
  });

  it('remaps a restored shape onto the segment the registry adopted', () => {
    const { segmentId, serialized } = serializedToolForSegment();

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    const { idMap: adopted } = segments().adopt([
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

  it('skips restored shapes whose parent is unresolved or was deleted', () => {
    const restored = usePolygonStore();
    seatAndView('healthy-img');
    useImageCacheStore().removeImage(IMAGE_ID);

    restored.deserializeTools(
      {
        tools: ['deleted', 'unresolved', 'healthy'].map((imageID) => ({
          imageID,
          placing: false,
        })),
      },
      {
        deleted: IMAGE_ID,
        healthy: 'healthy-img',
      }
    );

    expect(
      restored.tools.map(({ imageID, segmentId }) => ({
        imageID,
        segmentId,
      }))
    ).toEqual([{ imageID: 'healthy-img', segmentId: '' }]);
    expect(
      restored.serializeTools().tools.map(({ imageID }) => imageID)
    ).toEqual(['healthy-img']);
  });
});

describe('placing an annotation names its segment', () => {
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
    expect(segments().selectedSegmentId.value).toBeUndefined();

    const id = place(store);

    const segmentId = store.toolByID[id].segmentId!;
    expect(segments().getSegment(segmentId)).toBeDefined();
    expect(store.appearanceOfTool(id).name).toBe('Segment 1');
    // Geometry only: the mask waits for an edit that writes voxels.
    expect(segmentationOf(IMAGE_ID)).toBeUndefined();
  });

  it('mints the segment while the annotation is still being placed', () => {
    const store = useRectangleStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolSegment(id);

    expect(store.toolByID[id].placing).toBe(true);
    expect(segments().getSegment(store.toolByID[id].segmentId!)).toBeDefined();
  });

  it('mints once however many gestures the placement takes', () => {
    const store = usePolygonStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolSegment(id);
    store.resolveToolSegment(id);
    store.placeTool(id);

    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('leaves the placed segment selected so the next one reuses it', () => {
    const store = useRectangleStore();

    const first = place(store);
    const second = place(store);

    expect(store.toolByID[second].segmentId).toBe(
      store.toolByID[first].segmentId
    );
    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('hands the minted segment to the other delineation tools', () => {
    const rectangles = useRectangleStore();
    const polygons = usePolygonStore();

    const id = place(rectangles);
    const segmentId = rectangles.toolByID[id].segmentId!;

    const polygon = polygons.addTool({ imageID: IMAGE_ID, placing: false });
    expect(polygons.toolByID[polygon].segmentId).toBe(segmentId);
    // Paint resolves the same segment into this image's mask.
    expect(
      useSegmentationStore().getMask(
        useSegmentationStore().resolveEditTarget(IMAGE_ID)
      ).segmentId
    ).toBe(segmentId);
  });

  it('places against the selected segment rather than minting beside it', () => {
    const store = useRectangleStore();
    const segmentId = segments().addSegment({ name: 'Tumor' });

    const id = place(store);

    expect(store.toolByID[id].segmentId).toBe(segmentId);
    expect(segments().segmentList.value).toHaveLength(1);
  });

  it('keeps the stub a widget is placing into when its segment is deleted', () => {
    const store = useRulerStore();
    const segmentId = segments().addSegment({ name: 'Long axis' });
    const stub = store.addTool({ imageID: IMAGE_ID, placing: true, segmentId });
    const placed = store.addTool({ imageID: IMAGE_ID, segmentId });

    segments().deleteSegment(segmentId);

    // The placed ruler goes with its segment; the stub the widget still holds
    // stays, and naming it is deferred to the placement that commits it.
    expect(store.toolByID[placed]).toBeUndefined();
    expect(store.toolByID[stub].placing).toBe(true);

    store.placeTool(stub);

    expect(
      segments().getSegment(store.toolByID[stub].segmentId!)
    ).toBeDefined();
  });

  it('does not count a stub as a reference that keeps a segment alive', () => {
    const store = useRulerStore();
    // Dropping a config key deletes the segment it minted unless content
    // references it.
    const configured = () => {
      segments().replaceConfigSegments({ 'Long axis': {} });
      return segments().findSegmentByName('Long axis')!.id;
    };
    const unconfigure = () => segments().replaceConfigSegments({});

    const stubbed = configured();
    store.addTool({ imageID: IMAGE_ID, placing: true, segmentId: stubbed });
    unconfigure();

    expect(segments().getSegment(stubbed)).toBeUndefined();

    const measured = configured();
    store.addTool({ imageID: IMAGE_ID, segmentId: measured });
    unconfigure();

    expect(segments().getSegment(measured)).toBeDefined();
  });

  it('places a ruler in the shared registry, painting nothing', () => {
    const store = useRulerStore();

    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);

    expect(store.toolByID[id].placing).toBe(false);
    // A ruler names a segment like any other annotation, and marks no voxels.
    expect(segments().getSegment(store.toolByID[id].segmentId!)).toBeDefined();
    expect(segmentationOf(IMAGE_ID)).toBeUndefined();
  });
});
