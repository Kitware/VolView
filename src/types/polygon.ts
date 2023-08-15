import type { Vector2, Vector3 } from '@kitware/vtk.js/types';
import { AnnotationTool } from './annotation-tool';
import { WidgetAction } from '../vtk/ToolWidgetUtils/utils';

export type PolygonID = string & { __type: 'PolygonID' };

export type Polygon = {
  /**
   * Points is in image index space.
   */
  points: Array<Vector3>;
  movePoint: Vector3;
} & AnnotationTool<PolygonID>;

export type ContextMenuEvent = {
  displayXY: Vector2;
  widgetActions: Array<WidgetAction>;
};
