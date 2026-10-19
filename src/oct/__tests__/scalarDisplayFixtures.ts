import { prepareScalarPlane, scalarWindow } from '@/src/core/vtk/scalarPlane';

export function scalarImageFixture(
  values: ArrayLike<number>,
  thickness?: ArrayLike<number>
) {
  return {
    width: values.length,
    height: 1,
    values: Float64Array.from(values),
    thicknessMicrons: thickness ? Float64Array.from(thickness) : undefined,
  };
}

/** Numerical oracle for the scalar transform and VTK's linear grayscale map. */
export function scalarReferencePixels(
  values: ArrayLike<number>,
  window: { width: number; level: number }
) {
  const plane = prepareScalarPlane(values);
  const transformed = scalarWindow(window, plane.offset);
  return Uint8Array.from({ length: values.length * 4 }, (_, offset) => {
    if (offset % 4 === 3) return 255;
    const index = Math.floor(offset / 4);
    if (!Number.isFinite(values[index])) return 0;
    const normalized =
      (plane.scalars[index] - transformed.level) / transformed.width + 0.5;
    return Math.round(Math.min(1, Math.max(0, normalized)) * 255);
  });
}
