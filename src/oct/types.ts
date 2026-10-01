export type ProjectionAxis = 0 | 1 | 2;

export type ProjectionMethod = 'mean' | 'max' | 'sum';

/** Scalar voxels use VTK order: x + width * (y + height * z). */
export interface ScalarVolume {
  scalars: ArrayLike<number>;
  dimensions: readonly number[];
  /** Physical voxel spacing in millimeters. */
  spacing: readonly number[];
  numberOfComponents?: number;
}

export interface SegmentationProjection {
  scalars: ArrayLike<number>;
  dimensions: readonly number[];
  numberOfComponents?: number;
  /** Inclusive bounds in parent voxel coordinates; omitted for a full mask. */
  extent?: readonly number[];
  /** Positive label value to measure; binary segment masks use 1. */
  segmentValue?: number;
  thresholdMicrons: number;
}

export interface ProjectionInput {
  volume: ScalarVolume;
  axis: ProjectionAxis;
  method: ProjectionMethod;
  /** Inclusive voxel indices along the A-line axis. */
  depthStart: number;
  depthEnd: number;
  segmentation?: SegmentationProjection;
}

export interface ProjectionResult {
  /** The remaining voxel axes, in increasing axis order, are width then height. */
  width: number;
  height: number;
  values: Float32Array;
  /** Occupied thickness along the full A-line, independent of the intensity slab. */
  thicknessMicrons?: Float64Array;
  /** 1 only where present segment thickness is strictly below the threshold. */
  thinMask?: Uint8Array;
}
