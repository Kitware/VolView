import type { Vector3 } from '@kitware/vtk.js/types';
import { AnnotationTool } from './annotation-tool';

export type Ruler = {
  /**
   * Point is in image index space.
   */
  firstPoint: Vector3;
  /**
   * Point is in image index space.
   */
  secondPoint: Vector3;
} & AnnotationTool;
