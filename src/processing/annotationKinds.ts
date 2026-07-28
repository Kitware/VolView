// Shared mapping between wire annotation kinds and their client stores.

import type { AnnotationToolKind } from '@/backend-contract';
import { useAnnotationToolStore } from '@/src/store/tools';
import { AnnotationToolType } from '@/src/store/tools/types';
import type { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';

const ANNOTATION_TOOL_TYPE: Record<AnnotationToolKind, AnnotationToolType> = {
  rulers: AnnotationToolType.Ruler,
  rectangles: AnnotationToolType.Rectangle,
  polygons: AnnotationToolType.Polygon,
};

export const annotationToolStore = (
  kind: AnnotationToolKind
): AnnotationToolStore => useAnnotationToolStore(ANNOTATION_TOOL_TYPE[kind]);
