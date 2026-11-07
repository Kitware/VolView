import type { TypedArray } from '@kitware/vtk.js/types';
import type { DecodedChunkImage } from './types';
import {
  getBufferValueRange,
  valuesFitBuffer,
  samplesAreIntegral,
} from './allocateImageFromChunks';

export function assertSamplesRepresentable(
  decoded: ArrayLike<number>,
  range: { min: number; max: number },
  buffer: TypedArray,
  where: string
) {
  if (!valuesFitBuffer(range, buffer)) {
    const bufferRange = getBufferValueRange(buffer)!;
    throw new Error(
      `${where} has pixel values the volume it belongs to cannot represent. ` +
        `Its pixel values run from ${range.min} to ${range.max}, but the volume's buffer is ` +
        `${buffer.constructor.name}, holding values from ${bufferRange.min} to ${bufferRange.max}. ` +
        `Every file in a volume must decode to values its buffer can hold without conversion.`
    );
  }
  if (!samplesAreIntegral(decoded, buffer)) {
    throw new Error(
      `${where} has fractional pixel values the volume it belongs to cannot represent. ` +
        `Its pixel values run from ${range.min} to ${range.max}, but the volume's buffer is ` +
        `${buffer.constructor.name}, which holds only whole numbers. ` +
        `Every file in a volume must decode to values its buffer can hold without conversion.`
    );
  }
}

export function assertSingleFramePerFile(
  frames: number,
  count: number,
  where: string
) {
  if (frames > 1 && count > 1) {
    // we're trying to load multiple chunks where individual chunks have multiple frames
    throw new Error(
      `Loading a single volume from multiple DICOM files where individual files contain multiple frames is not supported. ` +
        `${where} contains ${frames} frames.`
    );
  }
}

// Each chunk gets a fixed slot: one frame per chunk in a multi-file volume,
// or the whole volume when a single multi-frame chunk fills it. A decoded
// chunk has to fill its slot exactly.
export function assertChunkFitsSlot(
  image: DecodedChunkImage,
  volume: { dims: number[]; componentCount: number; count: number },
  where: string
) {
  const { dims, componentCount, count } = volume;
  const multiFile = count > 1;
  const framesPerChunk = multiFile ? 1 : dims[2];
  const [chunkWidth, chunkHeight] = image.size;
  const chunkFrames = image.size[2] ?? 1;
  const chunkComponents = image.imageType.components;
  assertSampleCount(image, where);
  if (
    chunkWidth !== dims[0] ||
    chunkHeight !== dims[1] ||
    chunkFrames !== framesPerChunk ||
    chunkComponents !== componentCount
  ) {
    // A lone chunk defines the volume it fails to fit, so advice about
    // agreeing with the other files only makes sense for a multi-file volume.
    const advice = multiFile
      ? ' Every file in a volume must have the same Rows, Columns, and SamplesPerPixel.'
      : '';
    throw new Error(
      `${where} does not fit the volume it belongs to. ` +
        `It decoded to ${chunkWidth}x${chunkHeight}x${chunkFrames} with ${chunkComponents} component(s), ` +
        `but the volume has room for ${dims[0]}x${dims[1]}x${framesPerChunk} with ${componentCount} component(s).` +
        advice
    );
  }
}

function assertSampleCount(image: DecodedChunkImage, where: string) {
  const [width, height, frames = 1] = image.size;
  const expected = width * height * frames * image.imageType.components;
  if (image.data?.length !== expected)
    throw new Error(
      `${where} decoded ${image.data?.length ?? 0} samples; expected ${expected}`
    );
}
