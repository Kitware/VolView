import {
  float32Holds,
  getBufferValueRange,
  valuesFitBuffer,
  samplesAreIntegral,
} from './pixelFormat';

/** What a unit decodes to, or what its header says it will. */
export type UnitShape = Readonly<{
  size: readonly number[];
  components: number;
  samples: number;
}>;

export function assertSamplesRepresentable(
  decoded: ArrayLike<number>,
  range: { min: number; max: number },
  buffer: ArrayBufferView,
  {
    where,
    rescales,
  }: {
    where: string;
    /** Every frame calibration the samples went through; read only for Float32. */
    rescales: () => ReadonlyArray<{
      rescaleSlope: number;
      rescaleIntercept: number;
    }>;
  }
) {
  const unheld =
    buffer instanceof Float32Array
      ? rescales().find((rescale) => !float32Holds(range, rescale))
      : undefined;
  if (unheld) {
    throw new Error(
      `${where} has pixel values the volume it belongs to cannot represent. ` +
        `Its pixel values run from ${range.min} to ${range.max} with a rescale slope of ${unheld.rescaleSlope}, ` +
        `but the volume's buffer is Float32Array, which would merge or round values of that size. ` +
        `Every file in a volume must decode to values its buffer can hold without conversion.`
    );
  }
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
    throw new Error(
      `Loading a single volume from multiple DICOM files where individual files contain multiple frames is not supported. ` +
        `${where} contains ${frames} frames.`
    );
  }
}

// One frame per file in a multi-file volume, or any run of a lone instance's
// frames. A decoded unit has to fill its slices exactly.
export function assertUnitFits(
  unit: UnitShape,
  volume: Readonly<{
    dims: readonly number[];
    components: number;
    frames: number;
    multiFile: boolean;
  }>,
  where: string
) {
  const { dims, components, frames, multiFile } = volume;
  const [width, height, unitFrames = 1] = unit.size;
  assertSampleCount(unit, where);
  if (
    width !== dims[0] ||
    height !== dims[1] ||
    unitFrames !== frames ||
    unit.components !== components
  ) {
    // A lone instance defines the volume it fails to fit, so advice about
    // agreeing with the other files only makes sense for a multi-file volume.
    const advice = multiFile
      ? ' Every file in a volume must have the same Rows, Columns, and SamplesPerPixel.'
      : '';
    throw new Error(
      `${where} does not fit the volume it belongs to. ` +
        `It decoded to ${width}x${height}x${unitFrames} with ${unit.components} component(s), ` +
        `but the volume has room for ${dims[0]}x${dims[1]}x${frames} with ${components} component(s).` +
        advice
    );
  }
}

function assertSampleCount(unit: UnitShape, where: string) {
  const [width, height, frames = 1] = unit.size;
  const expected = width * height * frames * unit.components;
  if (unit.samples !== expected)
    throw new Error(
      `${where} decoded ${unit.samples} samples; expected ${expected}`
    );
}
