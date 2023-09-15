import type { Vector3 } from '@kitware/vtk.js/types';
import { AnnotationTool } from './annotation-tool';

export type PolygonID = string & { __type: 'PolygonID' };

export type Polygon = {
  /**
   * Points is in image index space.
   */
  points: Array<Vector3>;
} & AnnotationTool<PolygonID>;
