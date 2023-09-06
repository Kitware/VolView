import type { Vector2 } from '@kitware/vtk.js/types';
import { FrameOfReference } from '../utils/frameOfReference';
import { WidgetAction } from '../vtk/ToolWidgetUtils/utils';

export type AnnotationTool<ID extends string> = {
  id: ID;
  /**
   * The associated image dataset.
   *
   * The tool currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  slice: number;
  frameOfReference: FrameOfReference;

  /**
   * Is this tool unfinished?
   */
  placing?: boolean;

  label?: string;
  labelName?: string;

  color: string;
  name: string;

  hidden?: boolean;
};

export type ContextMenuEvent = {
  displayXY: Vector2;
  widgetActions: Array<WidgetAction>;
};
