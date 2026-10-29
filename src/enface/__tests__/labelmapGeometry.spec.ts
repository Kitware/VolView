import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { deriveSlabGeometry } from '@/src/core/slab/geometry';
import { useEnFaceLabelmaps } from '@/src/enface/useEnFaceLabelmaps';

describe('En face thin-region placement', () => {
  it.each([0, 1, 2] as const)(
    'keeps axis %i measurement pixels on the projected source grid during slab movement',
    async (axis) => {
      const source = vtkImageData.newInstance();
      source.setExtent([5, 7, -4, -1, 10, 14]);
      source.setOrigin([23, -8, 100]);
      source.setSpacing([-0.2, 0.7, 2]);
      source.setDirection([0, 1, 0, -1, 0, 0, 0, 0, 1]);
      const geometry = ref(
        deriveSlabGeometry(source, { axis, first: 0, last: 0, method: 'mean' })
      );
      const { width, height } = geometry.value;
      const counts = new Uint32Array(width * height);
      counts[width + 1] = 1;
      const scope = effectScope();
      const labelmap = scope.run(() =>
        useEnFaceLabelmaps(
          geometry,
          {
            width,
            height,
            counts,
            known: new Uint8Array(width * height).fill(1),
            maximumCount: 1,
          },
          20,
          10
        )
      )!;
      for (const depth of [0, 1]) {
        geometry.value = deriveSlabGeometry(source, {
          axis,
          first: depth,
          last: depth,
          method: 'mean',
        });
        await nextTick();
        const sourceIndex: [number, number, number] = [6, -3, 11];
        sourceIndex[axis] = [5, -4, 10][axis] + depth;
        const world = labelmap.value!.indexToWorld([1, 1, 0]);
        const expected = source.indexToWorld(sourceIndex);
        world.forEach((value, component) =>
          expect(value).toBeCloseTo(expected[component], 6)
        );
        expect(
          labelmap.value!.getPointData().getScalars().getData()[width + 1]
        ).toBe(1);
      }
      scope.stop();
      source.delete();
    }
  );
});
