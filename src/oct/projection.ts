import type {
  ProjectionInput,
  ProjectionResult,
  SegmentationProjection,
  ScalarVolume,
  ProjectionAxis,
  ProjectionMethod,
  ProjectionPaddingRange,
} from '@/src/oct/types';

function validateDimensions(dimensions: readonly number[], name: string) {
  if (
    dimensions.length !== 3 ||
    dimensions.some(
      (dimension) => !Number.isInteger(dimension) || dimension < 1
    )
  ) {
    throw new Error(`${name} requires three positive integer dimensions`);
  }
  const size = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(size)) {
    throw new Error(`${name} dimensions exceed the supported voxel count`);
  }
  return size;
}

function validateScalars(
  scalars: ArrayLike<number>,
  count: number,
  components: number | undefined,
  name: string
) {
  if ((components ?? 1) !== 1) {
    throw new Error(`${name} must have one scalar component per voxel`);
  }
  if (scalars.length !== count) {
    throw new Error(`${name} scalar count does not match its dimensions`);
  }
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(scalars[index])) {
      throw new Error(`${name} contains a nonfinite scalar at voxel ${index}`);
    }
  }
}

function validateVolume(volume: ScalarVolume) {
  const count = validateDimensions(volume.dimensions, 'OCT volume');
  validateScalars(
    volume.scalars,
    count,
    volume.numberOfComponents,
    'OCT volume'
  );
  if (
    volume.spacing.length !== 3 ||
    volume.spacing.some((spacing) => !Number.isFinite(spacing) || spacing <= 0)
  ) {
    throw new Error('OCT volume requires three finite positive spacings in mm');
  }
}

function validateMaskExtent(
  extent: readonly number[],
  dimensions: readonly number[],
  parentDimensions: readonly number[]
) {
  if (extent.length !== 6 || extent.some((value) => !Number.isInteger(value))) {
    throw new Error('Segmentation extent requires six integer bounds');
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = extent[2 * axis];
    const maximum = extent[2 * axis + 1];
    if (
      minimum < 0 ||
      maximum < minimum ||
      maximum >= parentDimensions[axis] ||
      maximum - minimum + 1 !== dimensions[axis]
    ) {
      throw new Error(
        'Segmentation dimensions and extent must align with the parent volume'
      );
    }
  }
}

function validateSegmentSettings(segmentation: SegmentationProjection) {
  const segmentValue = segmentation.segmentValue ?? 1;
  if (!Number.isInteger(segmentValue) || segmentValue <= 0) {
    throw new Error('Selected segment label must be a positive integer');
  }
  if (
    !Number.isFinite(segmentation.thresholdMicrons) ||
    segmentation.thresholdMicrons < 0
  ) {
    throw new Error('Thickness threshold must be finite and nonnegative');
  }
  for (let index = 0; index < segmentation.scalars.length; index += 1) {
    const label = segmentation.scalars[index];
    if (!Number.isInteger(label) || label < 0) {
      throw new Error(
        'Segmentation scalars must be nonnegative integer labels'
      );
    }
  }
  return segmentValue;
}

function prepareSegmentation(
  segmentation: SegmentationProjection,
  parentDimensions: readonly number[]
) {
  const count = validateDimensions(segmentation.dimensions, 'Segmentation');
  validateScalars(
    segmentation.scalars,
    count,
    segmentation.numberOfComponents,
    'Segmentation'
  );
  const extent = segmentation.extent ?? [
    0,
    parentDimensions[0] - 1,
    0,
    parentDimensions[1] - 1,
    0,
    parentDimensions[2] - 1,
  ];
  validateMaskExtent(extent, segmentation.dimensions, parentDimensions);
  const segmentValue = validateSegmentSettings(segmentation);
  const [dimX, dimY] = segmentation.dimensions;
  return {
    ...segmentation,
    extent,
    segmentValue,
    strides: [1, dimX, dimX * dimY],
  };
}

function validateAxis(axis: ProjectionAxis) {
  if (axis !== 0 && axis !== 1 && axis !== 2) {
    throw new Error('Projection axis must be 0, 1, or 2');
  }
}

function validateMethod(method: ProjectionMethod) {
  if (method !== 'mean' && method !== 'max' && method !== 'sum') {
    throw new Error('Projection method must be mean, max, or sum');
  }
}

function validateSlab(input: ProjectionInput) {
  const { depthStart, depthEnd, volume, axis } = input;
  if (
    !Number.isInteger(depthStart) ||
    !Number.isInteger(depthEnd) ||
    depthStart < 0 ||
    depthEnd < depthStart ||
    depthEnd >= volume.dimensions[axis]
  ) {
    throw new Error(
      'Projection slab must be an inclusive range within the volume'
    );
  }
}

function validatePaddingRange(range: ProjectionPaddingRange, frames: number) {
  if (
    !Number.isInteger(range.firstFrame) ||
    !Number.isInteger(range.lastFrame) ||
    range.firstFrame < 0 ||
    range.lastFrame < range.firstFrame ||
    range.lastFrame >= frames ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min > range.max
  )
    throw new Error(
      'OCT padding requires finite ordered bounds within the volume'
    );
}

function preparePadding(volume: ScalarVolume) {
  if (!volume.paddingRanges?.length) return undefined;
  const byFrame = new Array<ProjectionPaddingRange | undefined>(
    volume.dimensions[2]
  );
  for (const range of volume.paddingRanges) {
    validatePaddingRange(range, byFrame.length);
    for (let frame = range.firstFrame; frame <= range.lastFrame; frame += 1) {
      if (byFrame[frame])
        throw new Error('OCT padding frame ranges must not overlap');
      byFrame[frame] = range;
    }
  }
  return byFrame;
}
function prepareProjection(input: ProjectionInput) {
  validateVolume(input.volume);
  validateAxis(input.axis);
  validateMethod(input.method);
  validateSlab(input);
  const { volume, axis } = input;
  const horizontalAxis = axis === 0 ? 1 : 0;
  const verticalAxis = axis === 2 ? 1 : 2;
  const [dimX, dimY] = volume.dimensions;
  return {
    ...input,
    paddingByFrame: preparePadding(volume),
    horizontalAxis,
    verticalAxis,
    width: volume.dimensions[horizontalAxis],
    height: volume.dimensions[verticalAxis],
    strides: [1, dimX, dimX * dimY],
    // Convert units before multiplication to preserve decimal thresholds such as 20.8 µm.
    micronsPerVoxel: volume.spacing[axis] * 1000,
  };
}

function isPaddingVoxel(
  grid: ReturnType<typeof prepareProjection>,
  voxel: number
) {
  const range = grid.paddingByFrame?.[Math.floor(voxel / grid.strides[2])];
  if (!range) return false;
  const value = grid.volume.scalars[voxel];
  return value >= range.min && value <= range.max;
}
function projectIntensityLine(
  grid: ReturnType<typeof prepareProjection>,
  lineStart: number
) {
  let aggregate = grid.method === 'max' ? -Infinity : 0;
  const stride = grid.strides[grid.axis];
  let samples = 0;
  for (let depth = grid.depthStart; depth <= grid.depthEnd; depth += 1) {
    const voxel = lineStart + depth * stride;
    if (isPaddingVoxel(grid, voxel)) continue;
    samples += 1;
    const sample = grid.volume.scalars[voxel];
    aggregate =
      grid.method === 'max' ? Math.max(aggregate, sample) : aggregate + sample;
  }
  if (!samples) return NaN;
  const value = grid.method === 'mean' ? aggregate / samples : aggregate;
  if (!Number.isFinite(Math.fround(value))) {
    throw new Error('Projection intensity exceeds the supported scalar range');
  }
  return value;
}

function segmentThickness(
  grid: ReturnType<typeof prepareProjection>,
  mask: ReturnType<typeof prepareSegmentation>,
  column: number,
  row: number
) {
  const { horizontalAxis, verticalAxis, axis, micronsPerVoxel } = grid;
  const { extent, strides, scalars, dimensions, segmentValue } = mask;
  // Lines outside a bounded mask remain absent and are never highlighted.
  if (
    column < extent[2 * horizontalAxis] ||
    column > extent[2 * horizontalAxis + 1] ||
    row < extent[2 * verticalAxis] ||
    row > extent[2 * verticalAxis + 1]
  ) {
    return 0;
  }
  const start =
    (column - extent[2 * horizontalAxis]) * strides[horizontalAxis] +
    (row - extent[2 * verticalAxis]) * strides[verticalAxis];
  const parentStart =
    column * grid.strides[horizontalAxis] +
    row * grid.strides[verticalAxis] +
    extent[2 * axis] * grid.strides[axis];
  let occupiedVoxels = 0;
  for (let depth = 0; depth < dimensions[axis]; depth += 1) {
    if (scalars[start + depth * strides[axis]] !== segmentValue) continue;
    if (isPaddingVoxel(grid, parentStart + depth * grid.strides[axis]))
      return NaN;
    occupiedVoxels += 1;
  }
  const thickness = occupiedVoxels * micronsPerVoxel;
  if (!Number.isFinite(thickness)) {
    throw new Error('Segment thickness exceeds the supported scalar range');
  }
  return thickness;
}

function allocateResult(
  width: number,
  height: number,
  hasMask: boolean,
  hasPadding: boolean
): ProjectionResult {
  return {
    width,
    height,
    values: new Float32Array(width * height),
    validPixels: hasPadding ? new Uint8Array(width * height) : undefined,
    thicknessMicrons: hasMask ? new Float64Array(width * height) : undefined,
    thinMask: hasMask ? new Uint8Array(width * height) : undefined,
  };
}

function storeIntensity(
  result: ProjectionResult,
  pixel: number,
  value: number
) {
  if (Number.isNaN(value)) return 0;
  result.values[pixel] = value;
  if (result.validPixels) result.validPixels[pixel] = 1;
  return 1;
}
/**
 * Projects a Cartesian OCT volume along one voxel axis. It does not infer or
 * unwrap polar scan geometry: callers must provide a reconstructed volume.
 * Segment thickness counts occupied voxels, so disconnected regions count their
 * occupied depth rather than the empty gap between their outer surfaces.
 */
export function projectEnFace(input: ProjectionInput): ProjectionResult {
  const grid = prepareProjection(input);
  const mask = input.segmentation
    ? prepareSegmentation(input.segmentation, input.volume.dimensions)
    : undefined;
  const result = allocateResult(
    grid.width,
    grid.height,
    !!mask,
    !!grid.paddingByFrame
  );
  let validPixels = 0;
  for (let row = 0; row < grid.height; row += 1) {
    for (let column = 0; column < grid.width; column += 1) {
      const pixel = column + grid.width * row;
      const lineStart =
        column * grid.strides[grid.horizontalAxis] +
        row * grid.strides[grid.verticalAxis];
      validPixels += storeIntensity(
        result,
        pixel,
        projectIntensityLine(grid, lineStart)
      );
      if (mask) {
        const thickness = segmentThickness(grid, mask, column, row);
        result.thicknessMicrons![pixel] = thickness;
        result.thinMask![pixel] =
          thickness > 0 && thickness < mask.thresholdMicrons ? 1 : 0;
      }
    }
  }
  if (!validPixels)
    throw new Error(
      'The selected OCT slab contains only padding; choose a slab with image data.'
    );
  return result;
}
