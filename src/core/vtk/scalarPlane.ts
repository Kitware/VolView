import { scalarRange } from '@/src/utils/histogram';

export type ScalarPlaneInput = {
  width: number;
  height: number;
  spacing: readonly number[];
  values: Float32Array;
};

export type ScalarTransform = { offset: number; scale: number };

/** Same-sign, nearby floats subtract exactly; wide ranges retain their original values. */
export function prepareScalarPlane(values: Float32Array) {
  const { min, max } = scalarRange(values) ?? { min: 0, max: 0 };
  const offset =
    min > 0 && max <= 2 * min ? min : max < 0 && min >= 2 * max ? max : 0;
  const scale = 1;
  const scalars = new Float32Array(values.length);
  for (let index = 0; index < values.length; index++) {
    scalars[index] = Number.isFinite(values[index])
      ? (values[index] - offset) / scale
      : 0;
  }
  return { scalars, offset, scale };
}

export function scalarWindow(
  window: { width: number; level: number },
  transform: ScalarTransform
) {
  return {
    width: window.width / transform.scale,
    level: (window.level - transform.offset) / transform.scale,
  };
}
