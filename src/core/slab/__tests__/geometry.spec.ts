import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vector3 } from '@kitware/vtk.js/types';
import { vec3 } from 'gl-matrix';
import { deriveSlabGeometry } from '../geometry';
import { metadataFromVtkImageData } from '@/src/utils/imageMetadata';
import {
  get2DOrientationForSourceAxis,
  get2DViewingVectors,
} from '@/src/utils/getViewingVectors';

function source() {
  const image = vtkImageData.newInstance();
  image.setExtent([5, 7, -4, -1, 10, 14]);
  image.setOrigin([23, -8, 100]);
  image.setSpacing([-0.2, 0.7, 2]);
  const angle = 0.4;
  image.setDirection([
    0,
    Math.cos(angle),
    Math.sin(angle),
    -1,
    0,
    0,
    0,
    -Math.sin(angle),
    Math.cos(angle),
  ]);
  return image;
}

function expectPoint(actual: ArrayLike<number>, expected: ArrayLike<number>) {
  Array.from(actual).forEach((value, axis) =>
    expect(value).toBeCloseTo(expected[axis], 6)
  );
}

describe('slab source-world geometry', () => {
  it.each([0, 1, 2] as const)(
    'places axis %i pixels and highlights on the source voxel centers',
    (axis) => {
      const image = source();
      const geometry = deriveSlabGeometry(image, {
        axis,
        first: 0,
        last: 2,
        method: 'sum',
      });
      const sourceIndex: Vector3 = [6, -3, 11];
      const world = image.indexToWorld(sourceIndex);
      expectPoint(
        vec3.transformMat4([0, 0, 0], [1.5, 1.5, 0], geometry.pixelToWorld),
        world
      );
      expect(
        vec3.dot(
          geometry.planeNormal,
          vec3.sub([0, 0, 0], world, geometry.planeOrigin)
        )
      ).toBeCloseTo(0, 8);
      image.delete();
    }
  );

  it('uses the normal volume axis names, camera vectors, and complete bounds', () => {
    const image = source();
    const ordinaryMetadata = metadataFromVtkImageData(image);
    for (const name of ['Axial', 'Coronal', 'Sagittal'] as const) {
      const axis = ordinaryMetadata.lpsOrientation[name];
      const geometry = deriveSlabGeometry(image, {
        axis,
        first: 0,
        last: 0,
        method: 'mean',
      });
      expect(geometry.metadata).toEqual({ name: '', ...ordinaryMetadata });
      expect(
        get2DOrientationForSourceAxis(axis, geometry.metadata.lpsOrientation)
      ).toEqual({ name, ...get2DViewingVectors(name) });
    }
    image.delete();
  });

  it('preserves camera fit while moving through the full source depth', () => {
    const image = source();
    image.setSpacing([0.01, 0.01, 100]);
    const first = deriveSlabGeometry(image, {
      axis: 2,
      first: 0,
      last: 0,
      method: 'mean',
    });
    const last = deriveSlabGeometry(image, {
      axis: 2,
      first: 4,
      last: 4,
      method: 'mean',
    });
    expect(first.fitKey).toBe(last.fitKey);
    expect(first.metadata.worldBounds).toEqual(last.metadata.worldBounds);
    expect(vec3.distance(first.planeOrigin, last.planeOrigin)).toBeCloseTo(400);
    expectPoint(
      vec3.transformMat4([0, 0, 0], [0.5, 0.5, 0], last.pixelToWorld),
      image.indexToWorld([5, -4, 14])
    );
    image.delete();
  });
});
