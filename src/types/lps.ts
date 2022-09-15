import { vec3 } from 'gl-matrix';

export type LPSAxis = 'Axial' | 'Sagittal' | 'Coronal';

export type LPSAxisDir =
  | 'Left'
  | 'Right'
  | 'Posterior'
  | 'Anterior'
  | 'Superior'
  | 'Inferior';

export interface LPSDirections {
  // Maps LPS direction to world-space direction (not index-space direction)
  // These should match columns of the current image orientation matrix.
  Left: vec3;
  Right: vec3;
  Posterior: vec3;
  Anterior: vec3;
  Superior: vec3;
  Inferior: vec3;

  // maps LPS axis to column in direction matrix
  Coronal: 0 | 1 | 2;
  Sagittal: 0 | 1 | 2;
  Axial: 0 | 1 | 2;
}
