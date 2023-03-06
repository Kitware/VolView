import { Image, TypedArray } from 'itk-wasm';
import { runWasm } from './itkWasmUtils';

type ArrayLike = number[] | TypedArray;
function compareArrays(a: ArrayLike, b: ArrayLike) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function compareImageSpaces(imageA: Image, imageB: Image) {
  const compareProps = ['size', 'direction', 'origin', 'spacing'] as const;
  const equalKeys = compareProps.map((key) =>
    compareArrays(imageA[key], imageB[key])
  );
  return equalKeys.every((b) => b);
}

export async function resample(fixed: Image, moving: Image) {
  if (compareImageSpaces(fixed, moving)) return moving; // same space, just return

  const { size, spacing, origin, direction } = fixed;
  const args = [
    '--size',
    size.join(','),
    '--spacing',
    spacing.join(','),
    '--origin',
    origin.join(','),
    '--direction',
    direction.join(','),
  ];

  return runWasm('resample', args, [moving]);
}
