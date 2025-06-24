import * as Comlink from 'comlink';
import { TypedArray } from '@kitware/vtk.js/types';

export interface GaussianSmoothParams {
  sigma: number;
  label: number;
}

export interface GaussianSmoothInput {
  data: TypedArray | number[];
  dimensions: number[];
  spacing: [number, number, number];
  params: GaussianSmoothParams;
}

function generateGaussianKernel(
  sigma: number,
  radiusFactor = 1.5
): Float32Array {
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
): void {
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
          // eslint-disable-next-line no-param-reassign
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
          // eslint-disable-next-line no-param-reassign
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
          // eslint-disable-next-line no-param-reassign
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
): Float32Array {
  const totalSize = dimensions[0] * dimensions[1] * dimensions[2];
  const kernelX = generateGaussianKernel(sigmaPixels[0], radiusFactor);
  const kernelY = generateGaussianKernel(sigmaPixels[1], radiusFactor);
  const kernelZ = generateGaussianKernel(sigmaPixels[2], radiusFactor);
  const temp1 = new Float32Array(totalSize);
  const temp2 = new Float32Array(totalSize);
  const output = new Float32Array(totalSize);

  convolve1D(inputData, temp1, dimensions, kernelX, 0);
  convolve1D(temp1, temp2, dimensions, kernelY, 1);
  convolve1D(temp2, output, dimensions, kernelZ, 2);

  return output;
}

function createBinaryMask(
  data: TypedArray | number[],
  label: number
): Float32Array {
  const mask = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    mask[i] = data[i] === label ? 255.0 : 0.0;
  }
  return mask;
}

export function gaussianSmoothLabelMapWorker(input: {
  data: TypedArray | number[];
  dimensions: number[];
  spacing: [number, number, number];
  params: { sigma: number; label: number };
}): TypedArray {
  const { data: originalData, dimensions, spacing, params } = input;
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
    const outputData = new (originalData.constructor as any)(
      originalData.length
    );
    for (let i = 0; i < originalData.length; i++) {
      outputData[i] = originalData[i];
    }
    return outputData;
  }

  const sigmaPixels: [number, number, number] = [
    sigma / spacing[0],
    sigma / spacing[1],
    sigma / spacing[2],
  ];

  const binaryMask = createBinaryMask(originalData, label);
  const smoothedMask = gaussianFilter3D(
    binaryMask,
    dimensions,
    sigmaPixels,
    1.5
  );

  const threshold = 255.0 / 2.0;
  const outputData = new (originalData.constructor as any)(originalData.length);

  for (let i = 0; i < originalData.length; i++) {
    const originalLabel = originalData[i];
    const smoothedValue = smoothedMask[i];

    if (originalLabel === label || originalLabel === 0) {
      outputData[i] = smoothedValue > threshold ? label : 0;
    } else {
      outputData[i] = originalLabel;
    }
  }

  return outputData;
}

const workerApi = {
  gaussianSmoothLabelMapWorker,
};

Comlink.expose(workerApi);
