export type OccupiedDepthInput = {
  dimensions: readonly number[];
  axis: 0 | 1 | 2;
  first: number;
  last: number;
  mask: {
    values: Uint8Array;
    dimensions: readonly number[];
    /** Inclusive parent-image bounds of the cropped binary mask. */
    extent: readonly number[];
  };
};

export type OccupiedDepthResult = {
  width: number;
  height: number;
  counts: Uint32Array;
  maximumCount: number;
};

function voxelCount(dimensions: readonly number[]) {
  if (
    dimensions.length !== 3 ||
    dimensions.some((value) => !Number.isInteger(value) || value < 1)
  )
    throw new Error(
      'Occupied depth requires three positive integer dimensions.'
    );
  const count = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(count))
    throw new Error(
      'Occupied depth dimensions exceed the supported voxel count.'
    );
  return count;
}

function validateMaskStorage(mask: OccupiedDepthInput['mask']) {
  if (mask.values.length !== voxelCount(mask.dimensions))
    throw new Error('Mask scalar count does not match its dimensions.');
  validateBinaryValues(mask.values);
}

function validateMaskGeometry(input: OccupiedDepthInput) {
  const { mask, dimensions } = input;
  if (
    mask.extent.length !== 6 ||
    mask.extent.some((value) => !Number.isInteger(value))
  )
    throw new Error('Mask extent requires six integer bounds.');
  for (let axis = 0; axis < 3; axis++) {
    const first = mask.extent[2 * axis];
    const last = mask.extent[2 * axis + 1];
    if (
      first < 0 ||
      last < first ||
      last >= dimensions[axis] ||
      last - first + 1 !== mask.dimensions[axis]
    )
      throw new Error('Mask dimensions and extent must align with the source.');
  }
}

function validateBinaryValues(values: Uint8Array) {
  for (let index = 0; index < values.length; index++) {
    if (values[index] > 1)
      throw new Error('Occupied depth requires a binary mask.');
  }
}

function validateInput(input: OccupiedDepthInput) {
  voxelCount(input.dimensions);
  if (![0, 1, 2].includes(input.axis))
    throw new Error('Occupied depth axis must be 0, 1, or 2.');
  if (
    !Number.isInteger(input.first) ||
    !Number.isInteger(input.last) ||
    input.first < 0 ||
    input.last < input.first ||
    input.last >= input.dimensions[input.axis]
  )
    throw new Error('Occupied depth slab must be an inclusive source range.');
  validateMaskGeometry(input);
}

function selectedExtent(input: OccupiedDepthInput) {
  const extent = [...input.mask.extent];
  const offset = input.axis * 2;
  extent[offset] = Math.max(input.first, extent[offset]);
  extent[offset + 1] = Math.min(input.last, extent[offset + 1]);
  return extent;
}

const stridesOf = (dimensions: readonly number[]) => [
  1,
  dimensions[0],
  dimensions[0] * dimensions[1],
];

function accumulateRow(
  state: {
    values: Uint8Array;
    counts: Uint32Array;
    length: number;
    pixelStep: number;
  },
  maskStart: number,
  pixelStart: number
) {
  for (let x = 0; x < state.length; x++) {
    if (state.values[maskStart + x])
      state.counts[pixelStart + x * state.pixelStep]++;
  }
}

function countOccupiedDepth(input: OccupiedDepthInput): OccupiedDepthResult {
  validateInput(input);
  const horizontal = input.axis === 0 ? 1 : 0;
  const vertical = input.axis === 2 ? 1 : 2;
  const width = input.dimensions[horizontal];
  const height = input.dimensions[vertical];
  const counts = new Uint32Array(width * height);
  const maskStrides = stridesOf(input.mask.dimensions);
  const { extent } = input.mask;
  const selected = selectedExtent(input);
  const state = {
    values: input.mask.values,
    counts,
    length: Math.max(0, selected[1] - selected[0] + 1),
    pixelStep: input.axis === 0 ? 0 : 1,
  };
  // Contiguous X rows avoid strided full-depth reads on large masks.
  for (let z = selected[4]; z <= selected[5]; z++) {
    for (let y = selected[2]; y <= selected[3]; y++) {
      const point = [selected[0], y, z];
      accumulateRow(
        state,
        selected[0] -
          extent[0] +
          (y - extent[2]) * maskStrides[1] +
          (z - extent[4]) * maskStrides[2],
        point[horizontal] + width * point[vertical]
      );
    }
  }
  return {
    width,
    height,
    counts,
    maximumCount: counts.reduce(
      (maximum, count) => Math.max(maximum, count),
      0
    ),
  };
}

/** Reuses a validated, immutable mask snapshot across selected slabs. */
export function createOccupiedDepthMeasurer(mask: OccupiedDepthInput['mask']) {
  validateMaskStorage(mask);
  return (input: Omit<OccupiedDepthInput, 'mask'>) =>
    countOccupiedDepth({ ...input, mask });
}

/** Counts occupied source cells inside the selected slab, excluding gaps. */
export function measureOccupiedDepth(input: OccupiedDepthInput) {
  return createOccupiedDepthMeasurer(input.mask)(input);
}
