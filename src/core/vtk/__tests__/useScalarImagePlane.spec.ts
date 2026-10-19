import { describe, expect, it } from 'vitest';
import { effectScope, shallowRef, watch } from 'vue';
import { useScalarImagePlane } from '@/src/core/vtk/useScalarImagePlane';
import type { ScalarPlaneInput } from '@/src/core/vtk/scalarPlane';

const makePlane = (
  width: number,
  height: number,
  spacing: [number, number],
  values = new Float32Array(width * height)
): ScalarPlaneInput => ({ width, height, spacing, values });

describe('owned scalar plane geometry', () => {
  it('publishes pixel-center geometry before synchronous metadata observers run', () => {
    const input = shallowRef<ScalarPlaneInput | null>(null);
    const scope = effectScope();
    const plane = scope.run(() => useScalarImagePlane(input))!;
    const observations: unknown[] = [];
    const stop = watch(
      plane.metadata,
      (metadata) => {
        observations.push(
          metadata && {
            dimensions: [...metadata.dimensions],
            spacing: [...metadata.spacing],
            origin: [...metadata.origin],
            bounds: [...metadata.worldBounds],
          }
        );
      },
      { flush: 'sync' }
    );

    input.value = makePlane(3, 2, [2, 5]);
    const ownedImage = plane.imageData.value!;
    expect(observations).toHaveLength(1);
    expect(observations.at(-1)).toEqual({
      dimensions: [3, 2, 1],
      spacing: [2, 5, 1],
      origin: [1, 2.5, 0],
      bounds: [0, 6, 0, 10, -0.5, 0.5],
    });
    expect(ownedImage.indexToWorld([-0.5, -0.5, 0])).toEqual([0, 0, 0]);
    expect(ownedImage.indexToWorld([2.5, 1.5, 0])).toEqual([6, 10, 0]);

    input.value = makePlane(2, 4, [3, 0.5]);
    expect(plane.imageData.value).toBe(ownedImage);
    expect(observations).toHaveLength(2);
    expect(observations.at(-1)).toEqual({
      dimensions: [2, 4, 1],
      spacing: [3, 0.5, 1],
      origin: [1.5, 0.25, 0],
      bounds: [0, 6, 0, 2, -0.5, 0.5],
    });

    input.value = null;
    expect(plane.imageData.value).toBeNull();
    expect(observations.at(-1)).toBeNull();
    stop();
    scope.stop();
  });

  it('owns its render scalars through updates and releases them on disposal', () => {
    const values = Float32Array.from([65535, NaN]);
    const input = shallowRef<ScalarPlaneInput | null>(
      makePlane(2, 1, [1, 1], values)
    );
    const scope = effectScope();
    const plane = scope.run(() => useScalarImagePlane(input))!;
    const image = plane.imageData.value!;
    const scalars = image.getPointData().getScalars();

    expect(plane.transform.value).toEqual({ offset: 65535, scale: 1 });
    expect(Array.from(scalars.getData())).toEqual([0, 0]);
    expect(scalars.getData()).toBeInstanceOf(Float32Array);
    expect((scalars.getData() as Float32Array).buffer).not.toBe(values.buffer);
    expect(values[0]).toBe(65535);
    expect(values[1]).toBeNaN();

    input.value = makePlane(2, 1, [1, 1], Float32Array.from([1, 5]));
    expect(plane.imageData.value).toBe(image);
    expect(image.getPointData().getScalars()).toBe(scalars);
    expect(plane.transform.value).toEqual({ offset: 0, scale: 1 });
    expect(Array.from(scalars.getData())).toEqual([1, 5]);

    input.value = null;
    expect(image.isDeleted()).toBe(false);
    scope.stop();
    expect(image.isDeleted()).toBe(true);
    expect(scalars.isDeleted()).toBe(true);
  });
});
