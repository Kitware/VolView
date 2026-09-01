import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useImageCacheStore } from '@/src/store/image-cache';
import { useSegmentationStore } from '@/src/store/segmentations';
import vtkLabelMap from '@/src/vtk/LabelMap';

// ---------------------------------------------------------------------------
// Display state lives on the model: fill and outline opacity per segment, the
// two multipliers plus outline thickness per segmentation. Defaults are the
// identity ones, so a scene that never touches them renders as it did before.
// ---------------------------------------------------------------------------

const DIMENSIONS = [4, 4, 2] as const;
const VOXEL_COUNT = DIMENSIONS[0] * DIMENSIONS[1] * DIMENSIONS[2];

const store = () => useSegmentationStore();

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

function seatArtifact(imageId: string) {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions(DIMENSIONS as unknown as [number, number, number]);
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  labelmap.computeTransforms();
  return store().registerArtifact(labelmap, {
    parentImage: imageId,
    name: 'Group 1',
  });
}

describe('segmentation display state', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatImage('img-1');
  });

  describe('defaults', () => {
    it('gives a new segment fully opaque fill and outline', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentation.id);

      expect(segment.fillOpacity).toBe(1);
      expect(segment.outlineOpacity).toBe(1);
    });

    // 1 and 2 are what the per-view segment-group config defaulted to, so a
    // restored scene keeps the look it had before display state moved here.
    it('gives a new segmentation identity multipliers and a 2px outline', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');

      expect(segmentation.fillOpacity).toBe(1);
      expect(segmentation.outlineOpacity).toBe(1);
      expect(segmentation.outlineThickness).toBe(2);
    });

    it('gives a segment created by the edit path the same defaults', () => {
      const segment = store().getSegment(store().resolveEditTarget('img-1'));

      expect(segment.fillOpacity).toBe(1);
      expect(segment.outlineOpacity).toBe(1);
    });

    it('gives a decoded artifact catalog the same defaults', () => {
      const artifactId = seatArtifact('img-1');
      const [segment] = store().setArtifactSegments(artifactId, [
        {
          value: 1,
          name: 'Tumor',
          color: [255, 0, 0, 255],
          visible: false,
          locked: true,
        },
      ]);

      expect(segment.fillOpacity).toBe(1);
      expect(segment.outlineOpacity).toBe(1);
      // The descriptor's own flags still win.
      expect(segment.visible).toBe(false);
      expect(segment.locked).toBe(true);
    });
  });

  describe('editing', () => {
    it('patches display state through updateSegment without disturbing identity', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentation.id, { name: 'Tumor' });
      expect(segment.fillOpacity).toBe(1);

      store().updateSegment(segment.id, { fillOpacity: 0.4 });
      store().updateSegment(segment.id, {
        outlineOpacity: 0.25,
      });

      const updated = store().getSegment(segment.id);
      expect(updated.fillOpacity).toBe(0.4);
      expect(updated.outlineOpacity).toBe(0.25);
      expect(updated.id).toBe(segment.id);
      expect(updated.name).toBe('Tumor');
      expect(updated.visible).toBe(true);
    });

    it('keeps display state per segment', () => {
      const segmentation = store().ensureSegmentationForImage('img-1');
      const first = store().createSegment(segmentation.id);
      const second = store().createSegment(segmentation.id);

      store().updateSegment(first.id, {
        fillOpacity: 0,
        outlineOpacity: 0.5,
      });

      const sibling = store().getSegment(second.id);
      expect(sibling.fillOpacity).toBe(1);
      expect(sibling.outlineOpacity).toBe(1);
      expect(store().segmentations[segmentation.id].fillOpacity).toBe(1);
    });
  });

  // Without this the editor's sliders write state nothing renders from.
  describe('reaching the renderer', () => {
    it('projects each segment’s opacities onto its artifact', () => {
      const artifactId = seatArtifact('img-1');
      const segmentation = store().ensureSegmentationForImage('img-1');
      const segment = store().createSegment(segmentation.id, { name: 'Tumor' });
      store().ensureLabelmapBinding(segment.id, artifactId);

      store().updateSegment(segment.id, {
        fillOpacity: 0.4,
        outlineOpacity: 0.25,
      });

      expect(store().labelmapSegmentsByArtifact[artifactId]).toEqual([
        expect.objectContaining({ fillOpacity: 0.4, outlineOpacity: 0.25 }),
      ]);
    });
  });
});
