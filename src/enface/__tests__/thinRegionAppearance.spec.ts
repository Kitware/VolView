import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useThinRegionAppearance } from '@/src/enface/useThinRegionAppearance';

beforeEach(() => setActivePinia(createPinia()));

function appearanceScene() {
  const parent = vtkImageData.newInstance();
  parent.setDimensions(2, 2, 2);
  parent
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ values: new Uint16Array(8) }));
  const parentId = useImageCacheStore().addVTKImageData(parent, 'OCT');
  const store = useSegmentationStore();
  const registry = useSegmentStore().segments;
  const group = store.ensureSegmentationForImage(parentId);
  const segmentId = registry.addSegment({ color: [35, 215, 190, 255] });
  const mask = store.createMask(group.id, segmentId);
  const binding = store.ensureLabelmapBinding(mask.id);
  const maskId = ref<string | null>(mask.id);
  const appearance = useThinRegionAppearance(maskId);
  return {
    store,
    registry,
    group,
    segmentId,
    mask,
    binding,
    maskId,
    appearance,
  };
}

describe('thin-region appearance from the source segmentation', () => {
  it('uses the selected segment color and normal default fill without modifying mask storage', () => {
    const { appearance, binding } = appearanceScene();
    const scalars = binding.image.getPointData().getScalars().getData();
    expect(appearance.value).toEqual({
      color: [35, 215, 190, 255],
      fillOpacity: 0.3,
      outlineThickness: 2,
      outlineOpacity: 1,
      value: 1,
      reason: null,
    });
    expect(binding.image.getPointData().getScalars().getData()).toBe(scalars);
  });

  it('updates the resolved style when segment color or either fill opacity changes', () => {
    const { appearance, registry, store, group, segmentId } = appearanceScene();
    registry.updateSegment(segmentId, { color: [255, 0, 0, 255] });
    expect(appearance.value).toMatchObject({
      color: [255, 0, 0, 255],
      fillOpacity: 0.3,
    });
    registry.updateSegment(segmentId, { fillOpacity: 0.5 });
    expect(appearance.value!.fillOpacity).toBe(0.15);
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0.8 });
    expect(appearance.value!.fillOpacity).toBe(0.4);
    registry.updateSegment(segmentId, { color: [255, 0, 0, 128] });
    expect(appearance.value!.color).toEqual([255, 0, 0, 128]);
    expect(appearance.value!.fillOpacity).toBeCloseTo((128 / 255) * 0.5 * 0.8);
  });

  it('changes appearance with the selected mask and drops missing selections', () => {
    const { appearance, registry, store, group, maskId } = appearanceScene();
    const second = registry.addSegment({ color: [0, 255, 0, 255] });
    const mask = store.createMask(group.id, second);
    store.ensureLabelmapBinding(mask.id);
    maskId.value = mask.id;
    expect(appearance.value!.color).toEqual([0, 255, 0, 255]);
    registry.deleteSegment(second);
    expect(appearance.value).toBeNull();
    maskId.value = null;
    expect(appearance.value).toBeNull();
  });

  it('keeps outline-only highlighting available and explains fully hidden appearances', () => {
    const { appearance, registry, store, group, segmentId } = appearanceScene();
    registry.updateSegment(segmentId, { visible: false });
    expect(appearance.value).toMatchObject({
      fillOpacity: 0,
      reason: 'Show the selected segment to highlight thin regions.',
    });
    registry.updateSegment(segmentId, { visible: true, fillOpacity: 0 });
    expect(appearance.value).toMatchObject({
      fillOpacity: 0,
      outlineThickness: 2,
      outlineOpacity: 1,
      reason: null,
    });
    registry.updateSegment(segmentId, { fillOpacity: 1 });
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0 });
    expect(appearance.value).toMatchObject({
      fillOpacity: 0,
      reason: null,
    });
    registry.updateSegment(segmentId, { outlineOpacity: 0.5 });
    store.updateSegmentationDisplay(group.id, {
      outlineOpacity: 0.4,
      outlineThickness: 4,
    });
    expect(appearance.value).toMatchObject({
      outlineThickness: 4,
      outlineOpacity: 0.2,
      reason: null,
    });
    store.updateSegmentationDisplay(group.id, { outlineOpacity: 0 });
    expect(appearance.value!.reason).toContain(
      'fill opacity or enable an outline'
    );
    store.updateSegmentationDisplay(group.id, { outlineOpacity: 1 });
    expect(appearance.value!.reason).toBeNull();
    store.updateSegmentationDisplay(group.id, { outlineThickness: 0 });
    expect(appearance.value!.reason).toContain(
      'fill opacity or enable an outline'
    );
    store.updateSegmentationDisplay(group.id, { outlineThickness: 2 });
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0.3 });
    registry.updateSegment(segmentId, { color: [35, 215, 190, 0] });
    expect(appearance.value).toMatchObject({ fillOpacity: 0 });
    expect(appearance.value!.reason).toBeNull();
    registry.updateSegment(segmentId, {
      color: [35, 215, 190, 255],
      outlineOpacity: 0,
    });
    store.updateSegmentationDisplay(group.id, {
      outlineOpacity: 0,
      outlineThickness: 0,
    });
    expect(appearance.value).toMatchObject({ fillOpacity: 0.3, reason: null });
  });
});
