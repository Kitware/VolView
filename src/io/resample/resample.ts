import { Image } from 'itk-wasm';
import { runWasm } from './itkWasmUtils';


export async function resample(fixed: Image, moving: Image) {
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
