import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT } from '@/src/config';
import { rgbaToCssColor } from '@/src/types/segmentation';

const IMAGE_ID = 'img-1';

const types = () => useSegmentTypeStore().types;

const seatAndView = (id: string) => {
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
    id,
  });
  useViewStore().setDataForAllViews(id);
  return useSegmentationStore().ensureSegmentationForImage(id);
};

const recordsOf = (imageId: string) =>
  useSegmentationStore().getSegmentationForImage(imageId)!.order;

describe('shape references to segment types', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
  });

  it('lists every type in the shared registry, content or not', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor' });

    expect(store.types.typeList.value.map((type) => type.id)).toEqual([typeId]);
    expect(store.types.appearanceOf(typeId).name).toBe('Tumor');
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('keeps the selected type when the viewed image changes', async () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor' });

    seatAndView('img-2');
    await nextTick();

    expect(store.types.selectedTypeId.value).toBe(typeId);
    const id = store.addTool({ imageID: 'img-2', placing: false });
    expect(store.toolByID[id].typeId).toBe(typeId);
  });

  it('captures the selected type when a tool is added', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor' });

    const id = store.addTool({ imageID: IMAGE_ID, placing: false });

    expect(store.toolByID[id].typeId).toBe(typeId);
  });

  it('resolves the type name and color for the tool', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor', color: [214, 0, 0, 255] });

    const id = store.addTool({ imageID: IMAGE_ID, placing: false, typeId });

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
    const typeId = types().addType({ name: 'Tumor' });
    const id = store.addTool({ imageID: IMAGE_ID, placing: false, typeId });
    const before = store.toolByID[id];

    types().updateType(typeId, { name: 'Lesion' });

    expect(store.appearanceOfTool(id).name).toBe('Lesion');
    expect(store.toolByID[id]).toBe(before);
    expect(store.toolByID[id].typeId).toBe(typeId);
  });

  it('shows a recolor through the resolver', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor', color: [214, 0, 0, 255] });
    const id = store.addTool({ imageID: IMAGE_ID, placing: false, typeId });

    types().updateType(typeId, { color: [0, 0, 255, 255] });

    expect(store.appearanceOfTool(id).cssColor).toBe(
      rgbaToCssColor([0, 0, 255, 255])
    );
  });

  it('shares one registry between polygons and rectangles', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const typeId = polygons.types.addType({ name: 'Tumor' });

    expect(rectangles.types.getType(typeId)?.name).toBe('Tumor');
    expect(rectangles.types.selectedTypeId.value).toBe(typeId);
  });

  it('lets several shapes reference one type', () => {
    const polygons = usePolygonStore();
    const rectangles = useRectangleStore();
    const typeId = types().addType({ name: 'Tumor' });

    const first = polygons.addTool({ imageID: IMAGE_ID, placing: false });
    const second = polygons.addTool({ imageID: IMAGE_ID, placing: false });
    const third = rectangles.addTool({ imageID: IMAGE_ID, placing: false });

    expect(polygons.toolByID[first].typeId).toBe(typeId);
    expect(polygons.toolByID[second].typeId).toBe(typeId);
    expect(rectangles.toolByID[third].typeId).toBe(typeId);
    expect(first).not.toBe(second);
  });

  it('keeps the rectangle fill color a per-shape prop', () => {
    const rectangles = useRectangleStore();
    const typeId = types().addType({ name: 'Tumor' });

    const id = rectangles.addTool({ imageID: IMAGE_ID, placing: false });

    expect(rectangles.toolByID[id].fillColor).toBe('transparent');
    expect(types().getType(typeId)).not.toHaveProperty('fillColor');
  });

  it('allocates no voxels and no geometry for a type', () => {
    const store = usePolygonStore();

    types().addType({ name: 'Tumor' });

    expect(recordsOf(IMAGE_ID)).toEqual([]);
    expect(useSegmentationStore().artifactMeta).toEqual({});
    expect(store.toolIDs).toEqual([]);
  });

  it('restores a shape whose type did not come back as unlabeled', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor' });
    store.addTool({ imageID: IMAGE_ID, placing: false, typeId });

    const serialized = JSON.parse(JSON.stringify(store.serializeTools()));
    expect(serialized.tools[0].typeId).toBe(typeId);

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID });

    expect(restored.toolByID[restored.toolIDs[0]].typeId).toBe('');
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('remaps a restored shape onto the type the registry adopted', () => {
    const store = usePolygonStore();
    const typeId = types().addType({ name: 'Tumor' });
    store.addTool({ imageID: IMAGE_ID, placing: false, typeId });
    const serialized = JSON.parse(JSON.stringify(store.serializeTools()));

    setActivePinia(createPinia());
    seatAndView(IMAGE_ID);
    const restored = usePolygonStore();
    const adopted = types().adopt([
      {
        id: typeId,
        name: 'Tumor',
        color: [1, 2, 3, 255],
        visible: true,
        locked: false,
      },
    ]);
    restored.deserializeTools(serialized, { [IMAGE_ID]: IMAGE_ID }, adopted);

    const tool = restored.toolByID[restored.toolIDs[0]];
    expect(tool.typeId).toBe(adopted[typeId]);
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
    expect(store.types.selectedTypeId.value).toBeUndefined();

    const id = place(store);

    const typeId = store.toolByID[id].typeId!;
    expect(types().getType(typeId)).toBeDefined();
    expect(store.appearanceOfTool(id).name).toBe('Segment 1');
    // Geometry only: the mask waits for an edit that writes voxels.
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });

  it('mints the type while the annotation is still being placed', () => {
    const store = useRectangleStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolType(id);

    expect(store.toolByID[id].placing).toBe(true);
    expect(types().getType(store.toolByID[id].typeId!)).toBeDefined();
  });

  it('mints once however many gestures the placement takes', () => {
    const store = usePolygonStore();
    const id = store.addTool({ imageID: IMAGE_ID, placing: true });

    store.resolveToolType(id);
    store.resolveToolType(id);
    store.placeTool(id);

    expect(types().typeList.value).toHaveLength(1);
  });

  it('leaves the placed type selected so the next one reuses it', () => {
    const store = useRectangleStore();

    const first = place(store);
    const second = place(store);

    expect(store.toolByID[second].typeId).toBe(store.toolByID[first].typeId);
    expect(types().typeList.value).toHaveLength(1);
  });

  it('hands the minted type to the other delineation tools', () => {
    const rectangles = useRectangleStore();
    const polygons = usePolygonStore();

    const id = place(rectangles);
    const typeId = rectangles.toolByID[id].typeId!;

    expect(polygons.types.getType(typeId)).toBeDefined();
    expect(polygons.types.selectedTypeId.value).toBe(typeId);
    // Paint resolves the same type into this image's record.
    expect(
      useSegmentationStore().getSegment(
        useSegmentationStore().resolveEditTarget(IMAGE_ID)
      ).typeId
    ).toBe(typeId);
  });

  it('places against the selected type rather than minting beside it', () => {
    const store = useRectangleStore();
    const typeId = types().addType({ name: 'Tumor' });

    const id = place(store);

    expect(store.toolByID[id].typeId).toBe(typeId);
    expect(types().typeList.value).toHaveLength(1);
  });

  it('places a ruler in its own registry, touching no segmentation', () => {
    const store = useRulerStore();

    const id = store.addTool({ imageID: IMAGE_ID, placing: true });
    store.placeTool(id);

    expect(store.toolByID[id].placing).toBe(false);
    expect(types().getType(store.toolByID[id].typeId!)).toBeUndefined();
    expect(recordsOf(IMAGE_ID)).toEqual([]);
  });
});
