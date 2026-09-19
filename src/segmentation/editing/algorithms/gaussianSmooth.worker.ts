import * as Comlink from 'comlink';
import { TypedArray } from '@kitware/vtk.js/types';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';
import {
  clipExtent,
  extentSize,
  extentUnion,
  extentWithin,
  fullExtent,
  isEmptyExtent,
  markedExtent,
  padExtent,
  reframeMaskScalars,
  type Extent3D,
} from '@/src/segmentation/geometry';

// The kernel's reach and the padding grown for it must agree.
const RADIUS_FACTOR = 1.5;

type GaussianSmoothParams = {
  sigma: number;
};

type GaussianSmoothInput = {
  data: TypedArray | number[];
  dimensions: number[];
  spacing: [number, number, number];
  maskExtent: Extent3D;
  parentDimensions: [number, number, number];
  params: GaussianSmoothParams;
};

function generateGaussianKernel(sigma: number) {
  const radius = Math.ceil(sigma * RADIUS_FACTOR);
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
type AxisPass = {
  inputData: TypedArray | number[];
  outputData: TypedArray | number[];
  kernel: Float32Array;
  kernelCenter: number;
  // Voxels along the convolved axis, and the index step between them.
  count: number;
  stride: number;
};

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
  sigmaPixels: [number, number, number]
) {
  const totalSize = dimensions[0] * dimensions[1] * dimensions[2];
  const kernelX = generateGaussianKernel(sigmaPixels[0]);
  const kernelY = generateGaussianKernel(sigmaPixels[1]);
  const kernelZ = generateGaussianKernel(sigmaPixels[2]);
  const temp = new Float32Array(totalSize);
  const output = new Float32Array(totalSize);

  convolve1D(inputData, output, kernelX, { dimensions, axis: 0 });
  convolve1D(output, temp, kernelY, { dimensions, axis: 1 });
  convolve1D(temp, output, kernelZ, { dimensions, axis: 2 });

  return output;
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
 * The segment's binary mask over `bounds`, which is the only thing the
 * filter reads. Built in one pass rather than copying the mask out and
 * thresholding it afterwards: the copy is a second volume-sized Float32
 * array, live at the same time as this one.
 */
function extractSubMask(
  data: TypedArray | number[],
  dimensions: number[],
  bounds: number[]
) {
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds;
  const subDims = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  // Zero filled, so everything outside the buffer stays background.
  const subMask = new Float32Array(subDims[0] * subDims[1] * subDims[2]);

  forEachClippedVoxel(dimensions, bounds, (origIndex, subIndex) => {
    subMask[subIndex] = data[origIndex] === SEGMENT_VALUE ? 255.0 : 0.0;
  });

  return { subMask, subDims };
}

// Output storage includes the padding ring: mirroring at a parent face can
// turn on voxels beyond the input mask's allocation.
function copySubVolumeBack(
  subData: Float32Array,
  originalData: TypedArray | number[],
  region: { dimensions: number[]; bounds: number[] }
) {
  forEachClippedVoxel(
    region.dimensions,
    region.bounds,
    (origIndex, subIndex) => {
      originalData[origIndex] = subData[subIndex] > 127.5 ? SEGMENT_VALUE : 0;
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
  const { sigma } = params;

  if (sigma <= 0) {
    throw new Error('Sigma must be positive');
  }

  const sigmaPixels: [number, number, number] = [
    sigma / spacing[0],
    sigma / spacing[1],
    sigma / spacing[2],
  ];

  // Absent when the mask claims no voxel. There is then nothing to smooth,
  // which is the caller's "nothing to do": handing back a copy of the input
  // instead would open a preview between two identical states.
  const marked = markedExtent(originalData, maskExtent);
  if (isEmptyExtent(marked)) return undefined;

  // Ending the convolution volume at the parent's faces keeps the established
  // mirrored boundary wherever the mask sits, so the result does not depend on
  // how much of the parent the mask happens to be allocated over. Crop faces
  // are not clamped: outside the buffer reads as background.
  const smoothedExtent = clipExtent(
    padExtent(
      marked,
      sigmaPixels.map((axisSigma) => Math.ceil(axisSigma * RADIUS_FACTOR))
    ),
    fullExtent(parentDimensions)
  );
  const { subMask, subDims } = extractSubMask(
    originalData,
    dimensions,
    extentWithin(smoothedExtent, maskExtent)
  );

  const smoothedSubMask = gaussianFilter3D(subMask, subDims, sigmaPixels);

  const extent = extentUnion(maskExtent, smoothedExtent);
  const outputData = reframeMaskScalars(originalData, maskExtent, extent);
  copySubVolumeBack(smoothedSubMask, outputData, {
    dimensions: extentSize(extent),
    bounds: extentWithin(smoothedExtent, extent),
  });

  // Moved back rather than cloned, as the input was moved in.
  return Comlink.transfer({ scalars: outputData, extent }, [
    outputData.buffer as ArrayBuffer,
  ]);
}

const workerApi = {
  gaussianSmoothLabelMapWorker,
};

Comlink.expose(workerApi);
