import type { Vector3 } from '@kitware/vtk.js/types';
import { AnnotationTool } from './annotation-tool';

export type Polygon = {
  /**
   * Points are in world LPS millimeters.
   */
  points: Array<Vector3>;
} & AnnotationTool;
