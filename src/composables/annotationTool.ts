import { Ref, computed, ref } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/utils';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { LPSAxis } from '../types/lps';
import { AnnotationTool, ContextMenuEvent } from '../types/annotation-tool';
import { AnnotationToolStore } from '../store/tools/useAnnotationTool';
import { getCSSCoordinatesFromEvent } from '../utils/vtk-helpers';

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

// --- Context Menu --- //

export const useContextMenu = <ToolID extends string>() => {
  const contextMenu = ref<{
    open: (id: ToolID, e: ContextMenuEvent) => void;
  } | null>(null);
  const openContextMenu = (toolID: ToolID, event: ContextMenuEvent) => {
    if (!contextMenu.value)
      throw new Error('contextMenu component does not exist');
    contextMenu.value.open(toolID, event);
  };

  return { contextMenu, openContextMenu };
};

export const useRightClickContextMenu = (
  emit: (event: 'contextmenu', ...args: any[]) => void,
  widget: Ref<vtkAnnotationToolWidget | null>
) => {
  onVTKEvent(widget, 'onRightClickEvent', (eventData) => {
    const displayXY = getCSSCoordinatesFromEvent(eventData);
    if (displayXY) {
      emit('contextmenu', {
        displayXY,
        widgetActions: eventData.widgetActions,
      } satisfies ContextMenuEvent);
    }
  });
};
