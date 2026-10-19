import { scalarRange } from '@/src/utils/histogram';

export type ScalarPlaneInput = {
  width: number;
  height: number;
  spacing: readonly number[];
  values: ArrayLike<number>;
};

/** Recenter nearby same-sign values before the render-owned Float32 upload. */
export function prepareScalarPlane(values: ArrayLike<number>) {
  const { min, max } = scalarRange(values) ?? { min: 0, max: 0 };
  const offset =
    min > 0 && max <= 2 * min ? min : max < 0 && min >= 2 * max ? max : 0;
  const scalars = new Float32Array(values.length);
  for (let index = 0; index < values.length; index++) {
    scalars[index] = Number.isFinite(values[index])
      ? values[index] - offset
      : 0;
  }
  return { scalars, offset };
}

export function scalarWindow(
  window: { width: number; level: number },
  offset: number
) {
  return {
    width: window.width,
    level: window.level - offset,
  };
}
