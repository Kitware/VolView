import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { maskOn } from '@/src/store/__tests__/segmentMaskFixtures';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { TOOL_COLORS } from '@/src/config';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentStore } from '@/src/store/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { createSegmentRegistry } from '@/src/store/tools/segmentRegistry';
import { cssColorToRGBA } from '@/src/types/segmentation';

const seatImage = (id: string, name = 'CT') =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), name, {
    id,
  });

const namesOf = (registry: {
  segmentList: { value: Array<{ name: string }> };
}) => registry.segmentList.value.map((type) => type.name);

describe('segment type registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mints a type without allocating anything', () => {
    const registry = createSegmentRegistry();

    const id = registry.addSegment({ name: 'Tumor' });

    expect(registry.getSegment(id)?.name).toBe('Tumor');
    expect(registry.selectedSegmentId.value).toBe(id);
  });

  it('keeps a type id across a rename', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    registry.updateSegment(id, { name: 'Lesion' });

    expect(registry.getSegment(id)?.name).toBe('Lesion');
    expect(registry.segmentList.value.map((type) => type.id)).toEqual([id]);
  });

  it('assigns consecutive default segment names', () => {
    const registry = createSegmentRegistry();

    expect(registry.getSegment(registry.addSegment())?.name).toBe('Segment 1');
    expect(registry.getSegment(registry.addSegment())?.name).toBe('Segment 2');
  });

  it('cycles the tool colors for minted segments', () => {
    const registry = createSegmentRegistry();

    const ids = TOOL_COLORS.map(() => registry.addSegment());

    expect(ids.map((id) => registry.getSegment(id)?.color)).toEqual(
      TOOL_COLORS.map(cssColorToRGBA)
    );
  });

  it('lists segments in creation order, which is the render order', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment({ name: 'Tumor' });
    const second = registry.addSegment({ name: 'Node' });

    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
    expect(registry.orderIndexOf(first)).toBe(0);
    expect(registry.orderIndexOf(second)).toBe(1);
  });

  it('resolves absent appearance to the app defaults', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    const appearance = registry.appearanceOf(id);

    expect(appearance.fillOpacity).toBe(1);
    expect(appearance.outlineOpacity).toBe(1);
    expect(registry.getSegment(id)?.fillOpacity).toBeUndefined();
  });

  it('binds an exact name to the type already carrying it', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor', color: [1, 2, 3, 255] });

    expect(registry.segmentNamed('Tumor', { color: [9, 9, 9, 255] })).toBe(id);
    // The registry's own color wins on a match.
    expect(registry.getSegment(id)?.color).toEqual([1, 2, 3, 255]);
  });

  it('mints a type when no name matches', () => {
    const registry = createSegmentRegistry();
    registry.addSegment({ name: 'Tumor' });

    const id = registry.segmentNamed('Node');

    expect(registry.getSegment(id)?.name).toBe('Node');
    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
  });

  it('selects the first remaining type when the selected one is deleted', () => {
    const registry = createSegmentRegistry();
    const kept = registry.addSegment({ name: 'Tumor' });
    const doomed = registry.addSegment({ name: 'Node' });

    registry.deleteSegment(doomed);

    expect(registry.segmentList.value.map((type) => type.id)).toEqual([kept]);
    expect(registry.selectedSegmentId.value).toBe(kept);
  });

  it('clears the selection when the last type is deleted', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    registry.deleteSegment(id);

    expect(registry.segmentList.value).toEqual([]);
    expect(registry.selectedSegmentId.value).toBeFalsy();
  });

  it('hands a referenced type to the removal callback before dropping it', () => {
    const removed: string[] = [];
    const registry = createSegmentRegistry({
      hasReferences: (segmentId) => removed.length === 0 && !!segmentId,
      removeReferences: (segmentId) => removed.push(segmentId),
    });
    const id = registry.addSegment({ name: 'Tumor' });

    registry.deleteSegment(id);

    expect(removed).toEqual([id]);
    expect(registry.getSegment(id)).toBeUndefined();
  });

  it('mints and selects a type for the first edit that needs one', () => {
    const registry = createSegmentRegistry();

    const id = registry.ensureSelectedSegment();

    expect(registry.selectedSegmentId.value).toBe(id);
    // Idempotent: a second edit reuses the selection.
    expect(registry.ensureSelectedSegment()).toBe(id);
  });

  it('selects the first existing segment without adding a placeholder', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment({ name: 'Liver' });
    const second = registry.mintSegment({ name: 'Spleen' });
    expect(registry.ensureSelectedSegment()).toBe(first);
    expect(registry.segmentList.value.map((segment) => segment.name)).toEqual([
      'Liver',
      'Spleen',
    ]);
    registry.selectSegment(second);
    expect(registry.ensureSelectedSegment()).toBe(second);
  });

  it('refuses to select a type that does not exist', () => {
    const registry = createSegmentRegistry();

    registry.selectSegment('nope');

    expect(registry.selectedSegmentId.value).toBeUndefined();
  });

  it('adopts restored segments under fresh ids, overwriting nothing', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment({
      name: 'Tumor',
      color: [1, 1, 1, 255],
    });

    const idMap = registry.adopt([
      {
        id: existing,
        name: 'Tumor',
        color: [2, 2, 2, 255],
        visible: true,
        locked: false,
      },
    ]);

    expect(idMap[existing]).not.toBe(existing);
    expect(registry.getSegment(existing)?.color).toEqual([1, 1, 1, 255]);
    expect(registry.getSegment(idMap[existing])?.color).toEqual([2, 2, 2, 255]);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor']);
  });
});

describe('the shared registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatImage('img-1');
  });

  it('shares one registry across paint, rectangles, polygons and rulers', () => {
    const shared = useSegmentStore().segments;
    const id = usePolygonStore().segments.addSegment({ name: 'Tumor' });

    expect(useRectangleStore().segments.getSegment(id)?.name).toBe('Tumor');
    expect(useRulerStore().segments.getSegment(id)?.name).toBe('Tumor');
    expect(shared.selectedSegmentId.value).toBe(id);
    expect(maskOn('img-1', id).segmentId).toBe(id);
  });

  it('lets a ruler and a mask name the same segment', () => {
    const shared = useSegmentStore().segments;
    const id = shared.addSegment({ name: 'Tumor' });
    const rulerId = useRulerStore().addTool({
      imageID: 'img-1',
      segmentId: id,
    });
    const record = maskOn('img-1', id);

    shared.deleteSegment(id);

    expect(useRulerStore().toolByID[rulerId]).toBeUndefined();
    expect(useSegmentationStore().maskExists(record.id)).toBe(false);
  });

  it('starts the shared registry empty, so viewing creates nothing', () => {
    expect(useSegmentStore().segments.segmentList.value).toEqual([]);
    expect(useSegmentationStore().segmentations).toEqual({});
  });

  it('deletes a referenced type with its masks and shapes', () => {
    const shared = useSegmentStore().segments;
    const id = shared.addSegment({ name: 'Tumor' });
    const record = maskOn('img-1', id);
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      segmentId: id,
    });

    shared.deleteSegment(id);

    expect(useSegmentationStore().maskExists(record.id)).toBe(false);
    expect(usePolygonStore().toolByID[toolId]).toBeUndefined();
  });

  it('keeps a type when a mask on one image is deleted', () => {
    const shared = useSegmentStore().segments;
    seatImage('img-2');
    const id = shared.addSegment({ name: 'Tumor' });
    const record = maskOn('img-2', id);

    useSegmentationStore().deleteMask(record.id);

    expect(shared.getSegment(id)?.name).toBe('Tumor');
  });
});
