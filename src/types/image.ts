import { mat3, mat4, vec3 } from 'gl-matrix';
import type { Bounds } from '@kitware/vtk.js/types';
import { LPSDirections } from './lps';
import type { SpatialMetadata } from '@/packages/dicom/core';

export type ImageMetadata = {
  name: string;
  orientation: mat3;
  lpsOrientation: LPSDirections;
  spacing: vec3;
  origin: vec3;
  dimensions: vec3;
  worldBounds: Bounds;
  worldToIndex: mat4;
  indexToWorld: mat4;
  /** Absent when the reader has not reported how its spacing was established. */
  spatialMetadata?: SpatialMetadata;
};
