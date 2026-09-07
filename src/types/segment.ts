import type { RGBAColor } from '@kitware/vtk.js/types';

import {
  STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
  TOOL_COLORS,
} from '@/src/config';
import type { Maybe } from '@/src/types';
import type { LabelmapSegment } from '@/src/types/segmentation';
import { cssColorToRGBA, rgbaToCssColor } from '@/src/types/segmentation';

/**
 * Identity and shared appearance for everything drawn as one thing: a paint
 * mask on any image, a rectangle, a polygon. Appearance fields are absent
 * until set and mean "app default" while they are, so a configured or imported
 * type that states nothing follows the default and a ruler type carries no
 * meaningless opacity.
 */
export type Segment = {
  id: string;
  name: string;
  color: RGBAColor;
  // State the user sets on the thing itself, so it holds on every image.
  visible: boolean;
  locked: boolean;
  fillOpacity?: number;
  outlineOpacity?: number;
  strokeWidth?: number;
};

export type SegmentInit = Partial<Omit<Segment, 'id'>>;

export const DEFAULT_SEGMENT_COLOR = cssColorToRGBA(TOOL_COLORS[0]);

const APPEARANCE_DEFAULTS = {
  fillOpacity: 1,
  outlineOpacity: 1,
  strokeWidth: STROKE_WIDTH_ANNOTATION_TOOL_DEFAULT,
};

/**
 * The one resolver. Every renderer, editor and encoder reads a type through
 * it; nothing reads the optional fields directly, so an absent field means the
 * app default in exactly one place.
 */
export const resolveSegmentAppearance = (type: Maybe<Segment>) => {
  const color = type?.color ?? DEFAULT_SEGMENT_COLOR;
  return {
    name: type?.name ?? '',
    color,
    cssColor: rgbaToCssColor(color),
    visible: type?.visible ?? true,
    locked: type?.locked ?? false,
    fillOpacity: type?.fillOpacity ?? APPEARANCE_DEFAULTS.fillOpacity,
    outlineOpacity: type?.outlineOpacity ?? APPEARANCE_DEFAULTS.outlineOpacity,
    strokeWidth: type?.strokeWidth ?? APPEARANCE_DEFAULTS.strokeWidth,
  };
};

export type SegmentAppearance = ReturnType<typeof resolveSegmentAppearance>;

/**
 * The descriptor a record projects onto the label value its mask holds, all of
 * it resolved from the segment. The labelmap renderer and the .seg.nrrd writer
 * consume it.
 */
export const toLabelmapSegment = (
  type: Maybe<Segment>,
  labelValue: number
): LabelmapSegment => {
  const resolved = resolveSegmentAppearance(type);
  return {
    value: labelValue,
    name: resolved.name,
    color: [...resolved.color] as RGBAColor,
    visible: resolved.visible,
    locked: resolved.locked,
    fillOpacity: resolved.fillOpacity,
    outlineOpacity: resolved.outlineOpacity,
  };
};
