import * as Comlink from 'comlink';
import { TypedArray } from '@kitware/vtk.js/types';
import { createTypedArrayLike } from '@/src/utils';
import {
  extentSize,
  extentUnion,
  type Extent3D,
} from '@/src/segmentation/model';

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

function convolve1D(
  inputData: TypedArray | number[],
  outputData: TypedArray | number[],
  dimensions: number[],
  kernel: Float32Array,
  axis: 0 | 1 | 2
) {
  const [dimX, dimY, dimZ] = dimensions;
  const kernelSize = kernel.length;
  const kernelCenter = Math.floor(kernelSize / 2);
  const strideY = dimX;
  const strideZ = dimX * dimY;

  // Helper for robust boundary handling (mirroring)
  const getFinalCoord = (sampleCoord: number, axisDim: number) => {
    let finalCoord = sampleCoord;
    if (sampleCoord < 0) {
      finalCoord = -sampleCoord; // Reflect
    } else if (sampleCoord >= axisDim) {
      finalCoord = 2 * axisDim - sampleCoord - 2; // Reflect
    }
    // Clamp to ensure it's within bounds, useful if kernel is very large
    return Math.max(0, Math.min(axisDim - 1, finalCoord));
  };

  if (axis === 0) {
    // Convolve along X: optimal loop order is z, y, x for cache efficiency
    for (let z = 0; z < dimZ; z++) {
      const zOffset = z * strideZ;
      for (let y = 0; y < dimY; y++) {
        const yOffset = y * strideY;
        const baseOffset = yOffset + zOffset;
        for (let x = 0; x < dimX; x++) {
          let sum = 0;
          for (let k = 0; k < kernelSize; k++) {
            const sampleX = getFinalCoord(x + k - kernelCenter, dimX);
            const sampleIdx = sampleX + baseOffset;
            sum += inputData[sampleIdx] * kernel[k];
          }

          outputData[x + baseOffset] = sum;
        }
      }
    }
  } else if (axis === 1) {
    // Convolve along Y: optimal loop order is z, x, y
    for (let z = 0; z < dimZ; z++) {
      const zOffset = z * strideZ;
      for (let x = 0; x < dimX; x++) {
        const baseOffset = x + zOffset;
        for (let y = 0; y < dimY; y++) {
          let sum = 0;
          for (let k = 0; k < kernelSize; k++) {
            const sampleY = getFinalCoord(y + k - kernelCenter, dimY);
            const sampleIdx = baseOffset + sampleY * strideY;
            sum += inputData[sampleIdx] * kernel[k];
          }

          outputData[x + y * strideY + zOffset] = sum;
        }
      }
    }
  } else {
    // axis === 2, convolve along Z: optimal loop order is y, x, z
    for (let y = 0; y < dimY; y++) {
      const yOffset = y * strideY;
      for (let x = 0; x < dimX; x++) {
        const baseOffset = x + yOffset;
        for (let z = 0; z < dimZ; z++) {
          let sum = 0;
          for (let k = 0; k < kernelSize; k++) {
            const sampleZ = getFinalCoord(z + k - kernelCenter, dimZ);
            const sampleIdx = baseOffset + sampleZ * strideZ;
            sum += inputData[sampleIdx] * kernel[k];
          }

          outputData[baseOffset + z * strideZ] = sum;
        }
      }
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

  convolve1D(inputData, output, dimensions, kernelX, 0);
  convolve1D(output, temp, dimensions, kernelY, 1);
  convolve1D(temp, output, dimensions, kernelZ, 2);

  return output;
}

function calculateBoundingBox(
  data: TypedArray | number[],
  dimensions: number[],
  label: number
) {
  const [dimX, dimY, dimZ] = dimensions;
  const bounds = [dimX, -1, dimY, -1, dimZ, -1];

  for (let z = 0; z < dimZ; z++) {
    for (let y = 0; y < dimY; y++) {
      for (let x = 0; x < dimX; x++) {
        const index = x + y * dimX + z * dimX * dimY;
        if (data[index] === label) {
          bounds[0] = Math.min(bounds[0], x);
          bounds[1] = Math.max(bounds[1], x);
          bounds[2] = Math.min(bounds[2], y);
          bounds[3] = Math.max(bounds[3], y);
          bounds[4] = Math.min(bounds[4], z);
          bounds[5] = Math.max(bounds[5], z);
        }
      }
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

function extractSubVolume(
  data: TypedArray | number[],
  dimensions: number[],
  bounds: number[]
) {
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds;
  const subDims = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1];
  // Zero filled, so everything outside the buffer stays background.
  const subData = new Float32Array(subDims[0] * subDims[1] * subDims[2]);

  forEachClippedVoxel(dimensions, bounds, (origIndex, subIndex) => {
    subData[subIndex] = data[origIndex] as number;
  });

  return { subData, subDims };
}

// Output storage includes the padding ring: mirroring at a parent face can
// turn on voxels beyond the input mask's allocation.
function copySubVolumeBack(
  subData: Float32Array,
  originalData: TypedArray | number[],
  dimensions: number[],
  bounds: number[],
  label: number
) {
  forEachClippedVoxel(dimensions, bounds, (origIndex, subIndex) => {
    const origLabel = originalData[origIndex];
    if (origLabel === label || origLabel === 0) {
      originalData[origIndex] = subData[subIndex] > 127.5 ? label : 0;
    }
  });
}

function createBinaryMask(data: TypedArray | number[], label: number) {
  const mask = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    mask[i] = data[i] === label ? 255.0 : 0.0;
  }
  return mask;
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

  let originalLabelCount = 0;
  for (let i = 0; i < originalData.length; i++) {
    if (originalData[i] === label) {
      originalLabelCount++;
    }
  }

  if (originalLabelCount === 0) {
    const outputData = createTypedArrayLike(originalData, originalData.length);
    for (let i = 0; i < originalData.length; i++) {
      outputData[i] = originalData[i];
    }
    return { scalars: outputData, extent: maskExtent };
  }

  const sigmaPixels: [number, number, number] = [
    sigma / spacing[0],
    sigma / spacing[1],
    sigma / spacing[2],
  ];

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
  const { subData, subDims } = extractSubVolume(
    originalData,
    dimensions,
    expandedBounds
  );

  const subBinaryMask = createBinaryMask(subData, label);
  const smoothedSubMask = gaussianFilter3D(
    subBinaryMask,
    subDims,
    sigmaPixels,
    1.5
  );

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
    outputDimensions,
    smoothedBoundsInOutput,
    label
  );

  return { scalars: outputData, extent };
}

const workerApi = {
  gaussianSmoothLabelMapWorker,
};

Comlink.expose(workerApi);
