import { computed } from 'vue';

import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useAnnotationToolStore } from '@/src/store/tools';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import type { AnnotationTool } from '@/src/types/annotation-tool';

const SHAPE_TOOLS = [
  { type: AnnotationToolType.Ruler, icon: 'mdi-ruler' },
  { type: AnnotationToolType.Rectangle, icon: 'mdi-vector-square' },
  { type: AnnotationToolType.Polygon, icon: 'mdi-pentagon-outline' },
];

/** Where an annotation sits: a cine frame, or a slice on one image axis. */
const placement = (tool: AnnotationTool & { axis: string }) =>
  tool.frame != null
    ? `Frame ${tool.frame + 1}`
    : `${tool.axis} ${tool.slice + 1}`;

/**
 * The shapes drawn on the viewed image, grouped by the segment each one names.
 * A segment's row lists these under it, so the sidebar holds no second list of
 * the same annotations.
 */
export function useSegmentShapes() {
  const { currentImageID, currentImageMetadata } = useCurrentImage();

  const shapes = computed(() =>
    SHAPE_TOOLS.flatMap(({ type, icon }) => {
      const store = useAnnotationToolStore(type);
      const rulers = useRulerStore();
      return store.finishedTools
        .filter((tool) => tool.imageID === currentImageID.value)
        .map((tool) => {
          const { axis } = frameOfReferenceToImageSliceAndAxis(
            tool.frameOfReference,
            currentImageMetadata.value,
            { allowOutOfBoundsSlice: true }
          ) ?? { axis: 'unknown' };
          const located = { ...tool, axis };
          return {
            id: tool.id,
            type,
            icon,
            segmentId: tool.segmentId,
            hidden: !!tool.hidden,
            axis,
            slice: tool.slice,
            frame: tool.frame,
            placement: placement(located),
            // Only a ruler carries a number a user reads off the list.
            measurement:
              type === AnnotationToolType.Ruler
                ? `${rulers.lengthByID[tool.id].toFixed(2)}mm`
                : '',
            jumpTo: () => store.jumpToTool(tool.id),
            remove: () => store.removeTool(tool.id),
            toggleHidden: () =>
              store.updateTool(tool.id, {
                hidden: !store.toolByID[tool.id].hidden,
              }),
            setHidden: (hidden: boolean) =>
              store.updateTool(tool.id, { hidden }),
            assignSegment: (segmentId: string) =>
              store.updateTool(tool.id, { segmentId }),
          };
        });
    })
  );

  // Grouped once so a list of segments costs one pass over the shapes rather
  // than one pass per segment.
  const shapesBySegment = computed(() => {
    const bySegment = new Map<string, typeof shapes.value>();
    shapes.value.forEach((shape) => {
      if (!shape.segmentId) return;
      const group = bySegment.get(shape.segmentId);
      if (group) group.push(shape);
      else bySegment.set(shape.segmentId, [shape]);
    });
    return bySegment;
  });

  const shapesOf = (segmentId: string) =>
    shapesBySegment.value.get(segmentId) ?? [];

  return { shapes, shapesOf };
}

export type SegmentShape = ReturnType<
  typeof useSegmentShapes
>['shapes']['value'][number];
