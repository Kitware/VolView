import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { Ref, computed } from 'vue';
import { LPSAxis } from '../types/lps';
import { AnnotationTool } from '../types/annotation-tool';
import { AnnotationToolStore } from '../store/tools/useAnnotationTool';

// does the tools's frame of reference match
// the view's axis
const useDoesToolFrameMatchViewAxis = <
  ToolID extends string,
  Tool extends AnnotationTool<ToolID>
>(
  viewAxis: Ref<LPSAxis>,
  tool: Partial<Tool>
) => {
  if (!tool.frameOfReference) return false;

  const { currentImageMetadata } = useCurrentImage();
  const toolAxis = frameOfReferenceToImageSliceAndAxis(
    tool.frameOfReference,
    currentImageMetadata.value,
    {
      allowOutOfBoundsSlice: true,
    }
  );
  return !!toolAxis && toolAxis.axis === viewAxis.value;
};

export const useCurrentTools = <ToolID extends string>(
  toolStore: AnnotationToolStore<ToolID>,
  viewAxis: Ref<LPSAxis>
) =>
  computed(() => {
    const { currentImageID } = useCurrentImage();
    const curImageID = currentImageID.value;

    return toolStore.tools.filter((tool) => {
      // only show tools for the current image,
      // current view axis and not hidden
      return (
        tool.imageID === curImageID &&
        useDoesToolFrameMatchViewAxis(viewAxis, tool) &&
        !tool.hidden
      );
    });
  });
