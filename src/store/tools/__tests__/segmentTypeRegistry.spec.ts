import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { recordFor } from '@/src/store/__tests__/segmentMaskFixtures';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { RULER_TYPE_DEFAULTS, TOOL_COLORS } from '@/src/config';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { createSegmentTypeRegistry } from '@/src/store/tools/segmentTypeRegistry';
import { cssColorToRGBA } from '@/src/types/segmentation';

const seatImage = (id: string, name = 'CT') =>
  useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), name, {
    id,
  });

const namesOf = (registry: { typeList: { value: Array<{ name: string }> } }) =>
  registry.typeList.value.map((type) => type.name);

describe('segment type registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mints a type without allocating anything', () => {
    const registry = createSegmentTypeRegistry();

    const id = registry.addType({ name: 'Tumor' });

    expect(registry.getType(id)?.name).toBe('Tumor');
    expect(registry.selectedTypeId.value).toBe(id);
  });

  it('keeps a type id across a rename', () => {
    const registry = createSegmentTypeRegistry();
    const id = registry.addType({ name: 'Tumor' });

    registry.updateType(id, { name: 'Lesion' });

    expect(registry.getType(id)?.name).toBe('Lesion');
    expect(registry.typeList.value.map((type) => type.id)).toEqual([id]);
  });

  it('names a minted type after the registry prefix', () => {
    const registry = createSegmentTypeRegistry({ namePrefix: 'Label' });

    expect(registry.getType(registry.addType())?.name).toBe('Label 1');
    expect(registry.getType(registry.addType())?.name).toBe('Label 2');
  });

  it('cycles the tool colors for minted types', () => {
    const registry = createSegmentTypeRegistry();

    const ids = TOOL_COLORS.map(() => registry.addType());

    expect(ids.map((id) => registry.getType(id)?.color)).toEqual(
      TOOL_COLORS.map(cssColorToRGBA)
    );
  });

  it('lists types in creation order, which is the render order', () => {
    const registry = createSegmentTypeRegistry();
    const first = registry.addType({ name: 'Tumor' });
    const second = registry.addType({ name: 'Node' });

    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
    expect(registry.orderIndexOf(first)).toBe(0);
    expect(registry.orderIndexOf(second)).toBe(1);
  });

  it('resolves absent appearance to the app defaults', () => {
    const registry = createSegmentTypeRegistry();
    const id = registry.addType({ name: 'Tumor' });

    const appearance = registry.appearanceOf(id);

    expect(appearance.fillOpacity).toBe(1);
    expect(appearance.outlineOpacity).toBe(1);
    expect(registry.getType(id)?.fillOpacity).toBeUndefined();
  });

  it('binds an exact name to the type already carrying it', () => {
    const registry = createSegmentTypeRegistry();
    const id = registry.addType({ name: 'Tumor', color: [1, 2, 3, 255] });

    expect(registry.typeNamed('Tumor', { color: [9, 9, 9, 255] })).toBe(id);
    // The registry's own color wins on a match.
    expect(registry.getType(id)?.color).toEqual([1, 2, 3, 255]);
  });

  it('mints a type when no name matches', () => {
    const registry = createSegmentTypeRegistry();
    registry.addType({ name: 'Tumor' });

    const id = registry.typeNamed('Node');

    expect(registry.getType(id)?.name).toBe('Node');
    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
  });

  it('selects the first remaining type when the selected one is deleted', () => {
    const registry = createSegmentTypeRegistry();
    const kept = registry.addType({ name: 'Tumor' });
    const doomed = registry.addType({ name: 'Node' });

    registry.deleteType(doomed);

    expect(registry.typeList.value.map((type) => type.id)).toEqual([kept]);
    expect(registry.selectedTypeId.value).toBe(kept);
  });

  it('clears the selection when the last type is deleted', () => {
    const registry = createSegmentTypeRegistry();
    const id = registry.addType({ name: 'Tumor' });

    registry.deleteType(id);

    expect(registry.typeList.value).toEqual([]);
    expect(registry.selectedTypeId.value).toBeFalsy();
  });

  it('hands a referenced type to the removal callback before dropping it', () => {
    const removed: string[] = [];
    const registry = createSegmentTypeRegistry({
      hasReferences: (typeId) => removed.length === 0 && !!typeId,
      removeReferences: (typeId) => removed.push(typeId),
    });
    const id = registry.addType({ name: 'Tumor' });

    registry.deleteType(id);

    expect(removed).toEqual([id]);
    expect(registry.getType(id)).toBeUndefined();
  });

  it('mints and selects a type for the first edit that needs one', () => {
    const registry = createSegmentTypeRegistry();

    const id = registry.ensureSelectedType();

    expect(registry.selectedTypeId.value).toBe(id);
    // Idempotent: a second edit reuses the selection.
    expect(registry.ensureSelectedType()).toBe(id);
  });

  it('refuses to select a type that does not exist', () => {
    const registry = createSegmentTypeRegistry();

    registry.selectType('nope');

    expect(registry.selectedTypeId.value).toBeUndefined();
  });

  it('adopts restored types under fresh ids, overwriting nothing', () => {
    const registry = createSegmentTypeRegistry();
    const existing = registry.addType({ name: 'Tumor', color: [1, 1, 1, 255] });

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
    expect(registry.getType(existing)?.color).toEqual([1, 1, 1, 255]);
    expect(registry.getType(idMap[existing])?.color).toEqual([2, 2, 2, 255]);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor']);
  });
});

describe('shared and ruler registries', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seatImage('img-1');
  });

  it('shares one registry across paint, rectangles and polygons', () => {
    const shared = useSegmentTypeStore().types;
    const id = usePolygonStore().types.addType({ name: 'Tumor' });

    expect(useRectangleStore().types.getType(id)?.name).toBe('Tumor');
    expect(shared.selectedTypeId.value).toBe(id);
    expect(recordFor('img-1', id).typeId).toBe(id);
  });

  it('keeps ruler types out of the shared registry', () => {
    const rulerId = useRulerStore().types.addType({ name: 'Ruler type' });
    const sharedId = useSegmentTypeStore().types.addType({ name: 'Tumor' });

    expect(useSegmentTypeStore().types.getType(rulerId)).toBeUndefined();
    expect(useRulerStore().types.getType(sharedId)).toBeUndefined();
    expect(useRulerStore().types.selectedTypeId.value).toBe(rulerId);
    expect(useSegmentTypeStore().types.selectedTypeId.value).toBe(sharedId);
  });

  it('seeds the ruler registry from the app defaults', () => {
    expect(namesOf(useRulerStore().types)).toEqual(
      Object.keys(RULER_TYPE_DEFAULTS)
    );
  });

  it('starts the shared registry empty, so viewing creates nothing', () => {
    expect(useSegmentTypeStore().types.typeList.value).toEqual([]);
    expect(useSegmentationStore().segmentations).toEqual({});
  });

  it('deletes a referenced type with its masks and shapes', () => {
    const shared = useSegmentTypeStore().types;
    const id = shared.addType({ name: 'Tumor' });
    const record = recordFor('img-1', id);
    const toolId = usePolygonStore().addTool({ imageID: 'img-1', typeId: id });

    shared.deleteType(id);

    expect(useSegmentationStore().segmentExists(record.id)).toBe(false);
    expect(usePolygonStore().toolByID[toolId]).toBeUndefined();
  });

  it('keeps a type when a mask on one image is deleted', () => {
    const shared = useSegmentTypeStore().types;
    seatImage('img-2');
    const id = shared.addType({ name: 'Tumor' });
    const record = recordFor('img-2', id);

    useSegmentationStore().deleteSegment(record.id);

    expect(shared.getType(id)?.name).toBe('Tumor');
  });
});
