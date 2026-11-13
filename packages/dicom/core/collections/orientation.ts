/** Minimum agreement of normalized row and column direction cosines. */
export const ORIENTATION_TOLERANCE = 1e-4;

export const dot = (left: number[], right: number[], offset = 0) =>
  left[offset] * right[offset] +
  left[offset + 1] * right[offset + 1] +
  left[offset + 2] * right[offset + 2];

export const orientationsAgree = (left: number[], right: number[]) =>
  dot(left, right) >= 1 - ORIENTATION_TOLERANCE &&
  dot(left, right, 3) >= 1 - ORIENTATION_TOLERANCE;
