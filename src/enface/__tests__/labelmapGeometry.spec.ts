import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { mat3 } from 'gl-matrix';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { deriveSlabGeometry } from '@/src/core/slab/geometry';
import { useEnFaceLabelmaps } from '@/src/enface/useEnFaceLabelmaps';

const directions = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [0.8, 0.6, 0, -0.6, 0.8, 0, 0, 0, 1],
] satisfies mat3[];

describe('En face thin-region placement', () => {
  it.each(
    ([0, 1, 2] as const).flatMap((axis) =>
      directions.map((direction, orientation) => ({
        axis,
        direction,
        orientation,
      }))
    )
  )(
    'places rectangular axis $axis overlays at thick-slab midpoints for orientation $orientation',
    async ({ axis, direction }) => {
      const source = vtkImageData.newInstance();
      source.setExtent([5, 7, -4, -1, 10, 14]);
      source.setOrigin([23, -8, 100]);
      source.setSpacing([-0.2, 0.7, 2]);
      source.setDirection(direction);
      const geometry = ref(
        deriveSlabGeometry(source, { axis, first: 0, last: 0, method: 'mean' })
      );
      const { width, height } = geometry.value;
      const planeAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
      const dimensions = [3, 4, 5];
      expect([width, height]).toEqual(
        planeAxes.map((candidate) => dimensions[candidate])
      );
      const counts = new Uint32Array(width * height);
      counts[width - 1] = 1;
      counts[width * (height - 1)] = 2;
      counts[width * height - 1] = 3;
      const scope = effectScope();
      const labelmap = scope.run(() =>
        useEnFaceLabelmaps(
          geometry,
          {
            width,
            height,
            counts,
            maximumCount: 3,
          },
          25,
          10
        )
      )!;
      for (const [first, last] of [
        [0, 1],
        [1, 2],
      ]) {
        geometry.value = deriveSlabGeometry(source, {
          axis,
          first,
          last,
          method: 'mean',
        });
        await nextTick();
        expect(labelmap.value!.getDimensions()).toEqual([width, height, 1]);
        for (const [x, y] of [
          [0, 0],
          [width - 1, 0],
          [0, height - 1],
          [width - 1, height - 1],
        ]) {
          const sourceIndex: [number, number, number] = [5, -4, 10];
          sourceIndex[planeAxes[0]] += x;
          sourceIndex[planeAxes[1]] += y;
          sourceIndex[axis] += (first + last) / 2;
          const world = labelmap.value!.indexToWorld([x, y, 0]);
          const expected = source.indexToWorld(sourceIndex);
          world.forEach((value, component) =>
            expect(value).toBeCloseTo(expected[component], 6)
          );
        }
        expect(
          Array.from(labelmap.value!.getPointData().getScalars().getData())
        ).toEqual(
          Array.from({ length: width * height }, (_, index) =>
            index === width - 1 || index === width * (height - 1) ? 1 : 0
          )
        );
      }
      scope.stop();
      source.delete();
    }
  );
});
