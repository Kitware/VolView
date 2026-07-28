import type { Vector3 } from '@kitware/vtk.js/types';
import { AnnotationTool } from './annotation-tool';

export type Ruler = {
  /**
   * Point is in world LPS millimeters.
   */
  firstPoint: Vector3;
  /**
   * Point is in world LPS millimeters.
   */
  secondPoint: Vector3;
} & AnnotationTool;
