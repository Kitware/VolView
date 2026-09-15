import { defineStore } from 'pinia';
import { computed, markRaw } from 'vue';

import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useAnnotationToolStore } from '@/src/store/tools';
import { AnnotationToolType } from '@/src/store/tools/types';
import { useRulerStore } from '@/src/store/tools/rulers';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import type { LPSAxis } from '@/src/types/lps';
import type { Maybe } from '@/src/types';

const SHAPE_TOOLS = [
  { type: AnnotationToolType.Ruler, icon: 'mdi-ruler' },
  { type: AnnotationToolType.Rectangle, icon: 'mdi-vector-square' },
  { type: AnnotationToolType.Polygon, icon: 'mdi-pentagon-outline' },
];

const placement = (
  frame: Maybe<number>,
  axis: Maybe<LPSAxis>,
  slice: number
) =>
  frame != null ? `Frame ${frame + 1}` : `${axis ?? 'unknown'} ${slice + 1}`;

// One shape list for every sidebar reader, so a ruler drag rebuilds it once.
const useSegmentShapesStore = defineStore('segmentShapes', () => {
  // Global: a shared store must not take the image of whichever view built it.
  const { currentImageID, currentImageMetadata } = useCurrentImage('global');

  const rulers = useRulerStore();

  const shapes = computed(() =>
    SHAPE_TOOLS.flatMap(({ type, icon }) => {
      const store = useAnnotationToolStore(type);
      return store.finishedTools
        .filter((tool) => tool.imageID === currentImageID.value)
        .map((tool) => {
          const axis = frameOfReferenceToImageSliceAndAxis(
            tool.frameOfReference,
            currentImageMetadata.value,
            { allowOutOfBoundsSlice: true }
          )?.axis;
          return {
            id: tool.id,
            type,
            icon,
            segmentId: tool.segmentId,
            hidden: !!tool.hidden,
            axis,
            slice: tool.slice,
            frame: tool.frame,
            placement: placement(tool.frame, axis, tool.slice),
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

  // Raw, so a consumer holds the computed ref rather than its unwrapped value.
  return { segmentShapes: markRaw({ shapes, shapesOf }) };
});

/**
 * Finished shapes on the viewed image, shared by the Measurements list and the
 * segment rows' reveal.
 */
export const useSegmentShapes = () => useSegmentShapesStore().segmentShapes;
