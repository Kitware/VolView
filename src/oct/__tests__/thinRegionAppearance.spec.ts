import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref, watch } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useThinRegionAppearance } from '@/src/oct/useThinRegionAppearance';
import { thinRegionColor } from '@/src/oct/windowLevel';

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
      alpha: 0.3,
      reason: null,
    });
    expect(
      thinRegionColor(100, appearance.value!.color, appearance.value!.alpha)
    ).toEqual([81, 135, 127, 255]);
    expect(binding.image.getPointData().getScalars().getData()).toBe(scalars);
  });

  it('repaints when normal segment color or either fill opacity changes', () => {
    const { appearance, registry, store, group, segmentId } = appearanceScene();
    const painted: number[][] = [];
    const stop = watch(
      appearance,
      (value) => {
        if (value) painted.push(thinRegionColor(100, value.color, value.alpha));
      },
      { immediate: true, flush: 'sync' }
    );
    registry.updateSegment(segmentId, { color: [255, 0, 0, 255] });
    expect(painted.at(-1)).toEqual([147, 70, 70, 255]);
    registry.updateSegment(segmentId, { fillOpacity: 0.5 });
    expect(painted.at(-1)).toEqual([123, 85, 85, 255]);
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0.8 });
    expect(appearance.value!.alpha).toBe(0.4);
    expect(painted.at(-1)).toEqual([162, 60, 60, 255]);
    registry.updateSegment(segmentId, { color: [255, 0, 0, 128] });
    expect(appearance.value!.alpha).toBeCloseTo((128 / 255) * 0.5 * 0.8);
    expect(painted.at(-1)).toEqual([131, 80, 80, 255]);
    stop();
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

  it('explains invisible fills while leaving outline-only settings independent', () => {
    const { appearance, registry, store, group, segmentId } = appearanceScene();
    registry.updateSegment(segmentId, { visible: false });
    expect(appearance.value).toMatchObject({
      alpha: 0,
      reason: 'Show the selected segment to highlight thin regions.',
    });
    registry.updateSegment(segmentId, { visible: true, fillOpacity: 0 });
    expect(appearance.value!.reason).toContain('selected segment opacity');
    registry.updateSegment(segmentId, { fillOpacity: 1 });
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0 });
    expect(appearance.value).toMatchObject({
      alpha: 0,
      reason: 'Increase segmentation fill opacity to highlight thin regions.',
    });
    store.updateSegmentationDisplay(group.id, { fillOpacity: 0.3 });
    registry.updateSegment(segmentId, { color: [35, 215, 190, 0] });
    expect(appearance.value).toMatchObject({ alpha: 0 });
    expect(appearance.value!.reason).toContain('selected segment opacity');
    registry.updateSegment(segmentId, {
      color: [35, 215, 190, 255],
      outlineOpacity: 0,
    });
    store.updateSegmentationDisplay(group.id, {
      outlineOpacity: 0,
      outlineThickness: 0,
    });
    expect(appearance.value).toMatchObject({ alpha: 0.3, reason: null });
  });
});
