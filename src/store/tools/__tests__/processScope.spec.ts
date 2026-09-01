import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { useSegmentationStore } from '@/src/store/segmentations';
import { useFillBetweenStore } from '@/src/store/tools/fillBetween';
import { useGaussianSmoothStore } from '@/src/store/tools/gaussianSmooth';
import vtkLabelMap from '@/src/vtk/LabelMap';

// A process that writes one label value cannot run against an artifact-scoped
// target: with no segment to write, it refuses instead of touching the
// background.

const DIMENSIONS: [number, number, number] = [2, 2, 2];
const VOXEL_COUNT = 8;

const store = () => useSegmentationStore();

function seatArtifact() {
  const labelmap = vtkLabelMap.newInstance();
  labelmap.setDimensions(DIMENSIONS);
  labelmap.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(VOXEL_COUNT),
    })
  );
  labelmap.computeTransforms();

  const artifactId = store().registerArtifact(labelmap, {
    parentImage: 'image-1',
    name: 'Group 1',
  });
  return {
    scope: 'artifact' as const,
    artifactId,
    voxels: store().artifactVoxels(artifactId),
  };
}

describe('single-label processes reject an artifact-scoped target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('fill between needs an active segment', async () => {
    const target = seatArtifact();

    await expect(
      useFillBetweenStore().computeAlgorithm(target)
    ).rejects.toThrow(/active segment/i);
  });

  it('gaussian smooth needs an active segment', async () => {
    const target = seatArtifact();

    await expect(
      useGaussianSmoothStore().computeAlgorithm(target)
    ).rejects.toThrow(/active segment/i);
  });
});
