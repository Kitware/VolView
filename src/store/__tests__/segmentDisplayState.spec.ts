import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mintType } from '@/src/store/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import { useSegmentTypeStore } from '@/src/store/segmentTypes';
import { DEFAULT_SEGMENTATION_FILL_OPACITY } from '@/src/types/segmentation';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// Display state lives on the model: fill and outline opacity on the segment
// type, the two multipliers plus outline thickness on the per-image
// segmentation. An unset field means the app default, so a scene that never
// touches them renders as it did before.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();
const types = () => useSegmentTypeStore().types;

async function seatImage(id: string, name = 'CT') {
  const image = vtkImageData.newInstance({ spacing: [1, 1, 1] });
  image.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  image.computeTransforms();
  useImageCacheStore().addVTKImageData(image, name, { id });
  await nextTick();
  return id;
}

/** A labelmap in the parent's space, carrying one voxel of value 1. */
function makeImportedLabelmap() {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  const values = new Uint8Array(VOXEL_COUNT);
  values[0] = 1;
  labelmap
    .getPointData()
    .setScalars(vtkDataArray.newInstance({ numberOfComponents: 1, values }));
  labelmap.computeTransforms();
  return labelmap;
}

describe('segmentation display state', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('defaults', () => {
    it('resolves an unset type to fully opaque fill and outline', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentation.id, mintType());

      const appearance = types().appearanceOf(segment.typeId);
      expect(appearance.fillOpacity).toBe(1);
      expect(appearance.outlineOpacity).toBe(1);
      // Absent, not stored: the wire carries only what was set.
      expect(types().getType(segment.typeId)?.fillOpacity).toBeUndefined();
    });

    // A fresh segmentation tints the anatomy under it; the outline defaults
    // match what a legacy per-view config carried.
    it('gives a new segmentation a translucent fill and a 2px outline', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');

      expect(segmentation.fillOpacity).toBe(DEFAULT_SEGMENTATION_FILL_OPACITY);
      expect(segmentation.outlineOpacity).toBe(1);
      expect(segmentation.outlineThickness).toBe(2);
    });

    it('gives a type minted by the edit path the same defaults', () => {
      const segment = store().getSegment(store().resolveEditTarget('img-1'));

      const appearance = types().appearanceOf(segment.typeId);
      expect(appearance.fillOpacity).toBe(1);
      expect(appearance.outlineOpacity).toBe(1);
    });

    it('takes display state from a decoded segment descriptor', () => {
      const [segment] = store().splitLabelmapIntoSegments(
        'img-1',
        makeImportedLabelmap(),
        [
          {
            value: 1,
            name: 'Tumor',
            color: [255, 0, 0, 255],
            visible: false,
            locked: true,
            fillOpacity: 0.4,
            outlineOpacity: 0.25,
          },
        ]
      );

      // Opacity describes the thing shown, so it lands on the type it minted.
      const appearance = types().appearanceOf(segment.typeId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      // Visibility and lock describe the thing, so they land on the type.
      expect(appearance.visible).toBe(false);
      expect(appearance.locked).toBe(true);
    });
  });

  describe('editing', () => {
    it('patches display state through the type without disturbing identity', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(
        segmentation.id,
        mintType({ name: 'Tumor' })
      );
      expect(types().appearanceOf(segment.typeId).fillOpacity).toBe(1);

      types().updateType(segment.typeId, { fillOpacity: 0.4 });
      types().updateType(segment.typeId, { outlineOpacity: 0.25 });

      const updated = store().getSegment(segment.id);
      const appearance = types().appearanceOf(updated.typeId);
      expect(appearance.fillOpacity).toBe(0.4);
      expect(appearance.outlineOpacity).toBe(0.25);
      expect(updated.id).toBe(segment.id);
      expect(updated.typeId).toBe(segment.typeId);
      expect(appearance.name).toBe('Tumor');
      expect(appearance.visible).toBe(true);
    });

    it('keeps display state per type', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const first = store().createSegment(segmentation.id, mintType());
      const second = store().createSegment(segmentation.id, mintType());

      types().updateType(first.typeId, { fillOpacity: 0, outlineOpacity: 0.5 });

      const sibling = types().appearanceOf(
        store().getSegment(second.id).typeId
      );
      expect(sibling.fillOpacity).toBe(1);
      expect(sibling.outlineOpacity).toBe(1);
      expect(store().segmentations[segmentation.id].fillOpacity).toBe(
        DEFAULT_SEGMENTATION_FILL_OPACITY
      );
    });
  });

  // Without this the editor's sliders write state nothing renders from.
  describe('reaching the renderer', () => {
    it('projects each segment’s opacities onto its mask', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(
        segmentation.id,
        mintType({ name: 'Tumor' })
      );
      const { artifactId } = store().segmentVoxels(segment.id).materialize();

      types().updateType(segment.typeId, {
        fillOpacity: 0.4,
        outlineOpacity: 0.25,
      });

      expect(store().labelmapSegmentsByArtifact[artifactId]).toEqual([
        expect.objectContaining({ fillOpacity: 0.4, outlineOpacity: 0.25 }),
      ]);
    });
  });
});
