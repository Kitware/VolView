import * as Comlink from 'comlink';
import { TypedArray } from '@kitware/vtk.js/types';
import { createTypedArrayLike } from '@/src/utils';
import {
  extentSize,
  extentUnion,
  type Extent3D,
} from '@/src/segmentation/geometry';

export interface GaussianSmoothParams {
  sigma: number;
  label: number;
}

export interface GaussianSmoothInput {
  data: TypedArray | number[];
  dimensions: number[];
  spacing: [number, number, number];
  maskExtent: [number, number, number, number, number, number];
  parentDimensions: [number, number, number];
  params: GaussianSmoothParams;
}

function generateGaussianKernel(sigma: number, radiusFactor = 1.5) {
  const radius = Math.ceil(sigma * radiusFactor);
  const size = 2 * radius + 1;
  const kernel = new Float32Array(size);
  const center = radius;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - center;
    // VTK formula: exp(-(x * x) / (std * std * 2.0))
    const value = Math.exp(-(x * x) / (sigma * sigma * 2.0));
    kernel[i] = value;
    sum += value;
  }

  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

// Helper for robust boundary handling (mirroring)
function mirrorCoord(sampleCoord: number, axisDim: number) {
  let finalCoord = sampleCoord;
  if (sampleCoord < 0) {
    finalCoord = -sampleCoord; // Reflect
  } else if (sampleCoord >= axisDim) {
    finalCoord = 2 * axisDim - sampleCoord - 2; // Reflect
  }
  // Clamp to ensure it's within bounds, useful if kernel is very large
  return Math.max(0, Math.min(axisDim - 1, finalCoord));
}

/**
 * What stays fixed for one axis pass: the two buffers, the kernel, and how a
 * line along the convolved axis is addressed. Built once per pass, so walking
 * a line allocates nothing.
 */
interface AxisPass {
  inputData: TypedArray | number[];
  outputData: TypedArray | number[];
  kernel: Float32Array;
  kernelCenter: number;
  // Voxels along the convolved axis, and the index step between them.
  count: number;
  stride: number;
}

// Convolves the one line of voxels that starts at `lineStart` and runs along
// the pass's axis. Every axis reduces to this, because a line differs only in
// where it starts, how long it is, and how far apart its voxels sit.
function convolveLine(pass: AxisPass, lineStart: number) {
  const { inputData, outputData, kernel, kernelCenter, count, stride } = pass;
  const kernelSize = kernel.length;

  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < kernelSize; k++) {
      const sample = mirrorCoord(i + k - kernelCenter, count);
      sum += inputData[sample * stride + lineStart] * kernel[k];
    }

    outputData[i * stride + lineStart] = sum;
  }
}

function convolve1D(
  inputData: TypedArray | number[],
  outputData: TypedArray | number[],
  kernel: Float32Array,
  volume: { dimensions: number[]; axis: 0 | 1 | 2 }
) {
  const { dimensions, axis } = volume;
  const [dimX, dimY] = dimensions;
  const strides = [1, dimX, dimX * dimY];
  const pass: AxisPass = {
    inputData,
    outputData,
    kernel,
    kernelCenter: Math.floor(kernel.length / 2),
    count: dimensions[axis],
    stride: strides[axis],
  };

  // The two axes the pass does not walk, the widest-striding one outermost:
  // z, then y, then x. That is the loop order each axis wants for cache
  // efficiency, so convolving along X visits z, y, x, along Y visits z, x, y,
  // and along Z visits y, x, z.
  const outer = axis === 2 ? 1 : 2;
  const inner = axis === 0 ? 1 : 0;

  for (let o = 0; o < dimensions[outer]; o++) {
    const outerOffset = o * strides[outer];
    for (let i = 0; i < dimensions[inner]; i++) {
      convolveLine(pass, outerOffset + i * strides[inner]);
    }
  }
}

function gaussianFilter3D(
  inputData: TypedArray | number[],
  dimensions: number[],
  sigmaPixels: [number, number, number],
  radiusFactor = 1.5
) {
  const totalSize = dimensions[0] * dimensions[1] * dimensions[2];
  const kernelX = generateGaussianKernel(sigmaPixels[0], radiusFactor);
  const kernelY = generateGaussianKernel(sigmaPixels[1], radiusFactor);
  const kernelZ = generateGaussianKernel(sigmaPixels[2], radiusFactor);
  const temp = new Float32Array(totalSize);
  const output = new Float32Array(totalSize);

  convolve1D(inputData, output, kernelX, { dimensions, axis: 0 });
  convolve1D(output, temp, kernelY, { dimensions, axis: 1 });
  convolve1D(temp, output, kernelZ, { dimensions, axis: 2 });

  return output;
}

// What a bounding-box scan holds still: the voxels being read, the bounds
// being widened, and the row addressing. Built once, so scanning a row
// allocates nothing.
interface RowScan {
  data: TypedArray | number[];
  bounds: number[];
  dimX: number;
  sliceSize: number;
  label: number;
}

// Widens the bounds over one x row. Its own function so that the per-voxel
// test sits two blocks deep rather than four.
function growBoundsOverRow(scan: RowScan, y: number, z: number) {
  const { data, bounds, dimX, sliceSize, label } = scan;
  const rowStart = y * dimX + z * sliceSize;

  for (let x = 0; x < dimX; x++) {
    if (data[rowStart + x] !== label) continue;
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.max(bounds[1], x);
    bounds[2] = Math.min(bounds[2], y);
    bounds[3] = Math.max(bounds[3], y);
    bounds[4] = Math.min(bounds[4], z);
    bounds[5] = Math.max(bounds[5], z);
  }
}

function calculateBoundingBox(
  data: TypedArray | number[],
  dimensions: number[],
  label: number
) {
  const [dimX, dimY, dimZ] = dimensions;
  const bounds = [dimX, -1, dimY, -1, dimZ, -1];
  const scan: RowScan = {
    data,
    bounds,
    dimX,
    sliceSize: dimX * dimY,
    label,
  };

  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      growBoundsOverRow(scan, y, z);
    }
  }

  if (bounds[1] === -1) return null;

  return bounds;
}

function expandBoundingBox({
  bounds,
  maskExtent,
  parentDimensions,
  sigmaPixels,
  radiusFactor = 1.5,
}: {
  bounds: number[];
  maskExtent: GaussianSmoothInput['maskExtent'];
  parentDimensions: GaussianSmoothInput['parentDimensions'];
  sigmaPixels: [number, number, number];
  radiusFactor?: number;
}) {
  return sigmaPixels.flatMap((sigma, axis) => {
    const padding = Math.ceil(sigma * radiusFactor);
    // The parent-image faces, stated in mask coordinates. Ending the
    // convolution volume there keeps the established mirrored boundary
    // wherever the mask sits, so the result does not depend on how much of
    // the parent the mask happens to be allocated over. Crop faces are not
    // clamped: outside the buffer reads as background.
    const parentLow = -maskExtent[axis * 2];
    const parentHigh = parentDimensions[axis] - 1 - maskExtent[axis * 2];
    return [
      Math.max(parentLow, bounds[axis * 2] - padding),
      Math.min(parentHigh, bounds[axis * 2 + 1] + padding),
    ];
  });
}

/**
 * Visits every voxel of `bounds` that the volume actually holds, giving each
 * its offset in the volume and its offset in the padded sub-volume. The
 * padding ring outside the volume is skipped by clipping the loops, not tested
 * per voxel.
 */
function forEachClippedVoxel(
  dimensions: number[],
  bounds: number[],
  visit: (origIndex: number, subIndex: number) => void
) {
  const [dimX, dimY, dimZ] = dimensions;
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds;
  const subDimX = maxX - minX + 1;
  const subDimY = maxY - minY + 1;
  const lastX = Math.min(maxX, dimX - 1);

  for (let z = Math.max(minZ, 0); z <= Math.min(maxZ, dimZ - 1); z += 1) {
    for (let y = Math.max(minY, 0); y <= Math.min(maxY, dimY - 1); y += 1) {
      const rowOrig = y * dimX + z * dimX * dimY;
      const rowSub = (y - minY) * subDimX + (z - minZ) * subDimX * subDimY;
      for (let x = Math.max(minX, 0); x <= lastX; x += 1) {
        visit(x + rowOrig, x - minX + rowSub);
      }
    }
  }
}

/**
 * The label's own binary mask over `bounds`, which is the only thing the
 * filter reads. Built in one pass rather than copying the labels out and
 * thresholding them afterwards: the copy is a second volume-sized Float32
 * array, live at the same time as this one.
 */
function extractSubMask(
  data: TypedArray | number[],
  dimensions: number[],
  bounds: number[],
  label: number
) {
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds;
  const subDims = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  // Zero filled, so everything outside the buffer stays background.
  const subMask = new Float32Array(subDims[0] * subDims[1] * subDims[2]);

  forEachClippedVoxel(dimensions, bounds, (origIndex, subIndex) => {
    subMask[subIndex] = data[origIndex] === label ? 255.0 : 0.0;
  });

  return { subMask, subDims };
}

// Output storage includes the padding ring: mirroring at a parent face can
// turn on voxels beyond the input mask's allocation.
function copySubVolumeBack(
  subData: Float32Array,
  originalData: TypedArray | number[],
  region: { dimensions: number[]; bounds: number[] },
  label: number
) {
  forEachClippedVoxel(
    region.dimensions,
    region.bounds,
    (origIndex, subIndex) => {
      const origLabel = originalData[origIndex];
      if (origLabel === label || origLabel === 0) {
        originalData[origIndex] = subData[subIndex] > 127.5 ? label : 0;
      }
    }
  );
}

export function gaussianSmoothLabelMapWorker(input: GaussianSmoothInput) {
  const {
    data: originalData,
    dimensions,
    spacing,
    maskExtent,
    parentDimensions,
    params,
  } = input;
  const { sigma, label } = params;

  if (sigma <= 0) {
    throw new Error('Sigma must be positive');
  }

  const sigmaPixels: [number, number, number] = [
    sigma / spacing[0],
    sigma / spacing[1],
    sigma / spacing[2],
  ];

  // Absent when the label is nowhere in the mask, which is also the whole
  // answer for a mask with nothing to smooth: it comes back as it went in.
  const bounds = calculateBoundingBox(originalData, dimensions, label);
  if (!bounds) {
    const outputData = createTypedArrayLike(originalData, originalData.length);
    for (let i = 0; i < originalData.length; i++) {
      outputData[i] = originalData[i];
    }
    return { scalars: outputData, extent: maskExtent };
  }

  const expandedBounds = expandBoundingBox({
    bounds,
    maskExtent,
    parentDimensions,
    sigmaPixels,
  });
  const { subMask, subDims } = extractSubMask(
    originalData,
    dimensions,
    expandedBounds,
    label
  );

  const smoothedSubMask = gaussianFilter3D(subMask, subDims, sigmaPixels, 1.5);

  const expandedExtent = expandedBounds.map(
    (value, axis) => value + maskExtent[axis - (axis % 2)]
  ) as Extent3D;
  const extent = extentUnion(maskExtent, expandedExtent);
  const outputDimensions = extentSize(extent);
  const outputData = createTypedArrayLike(
    originalData,
    outputDimensions[0] * outputDimensions[1] * outputDimensions[2]
  );
  const outputBoundsInInput = extent.map(
    (value, axis) => value - maskExtent[axis - (axis % 2)]
  );
  forEachClippedVoxel(
    dimensions,
    outputBoundsInInput,
    (origIndex, outIndex) => {
      outputData[outIndex] = originalData[origIndex];
    }
  );
  const smoothedBoundsInOutput = expandedExtent.map(
    (value, axis) => value - extent[axis - (axis % 2)]
  );

  copySubVolumeBack(
    smoothedSubMask,
    outputData,
    { dimensions: outputDimensions, bounds: smoothedBoundsInOutput },
    label
  );

  return { scalars: outputData, extent };
}

const workerApi = {
  gaussianSmoothLabelMapWorker,
};

Comlink.expose(workerApi);
