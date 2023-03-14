import { arrayEquals } from '@/src/utils';
import { Image } from 'itk-wasm';
import { runWasm } from './itkWasmUtils';


const compareProps = ['size', 'direction', 'origin', 'spacing'] as const;

export function compareImageSpaces(imageA: Image, imageB: Image) {
  const equalKeys = compareProps.map((key) =>
    arrayEquals(imageA[key], imageB[key])
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
