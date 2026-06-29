<script setup lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { WIDGET_PRIORITY } from '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import type {
  vtkAnnotationToolWidget,
  vtkAnnotationWidgetState,
} from '@/src/vtk/ToolWidgetUtils/types';
import { inject } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const selectionStore = useToolSelectionStore();
const toolStore = useToolStore();

const PLACING_TOOLS = [Tools.Ruler, Tools.Rectangle, Tools.Polygon];

const isAnnotationWidgetState = (
  widgetState: unknown
): widgetState is vtkAnnotationWidgetState => {
  const candidate = widgetState as Partial<vtkAnnotationWidgetState> | null;
  return (
    !!candidate &&
    typeof candidate.getId === 'function' &&
    typeof candidate.getToolType === 'function'
  );
};

onVTKEvent(
  view.interactor,
  'onLeftButtonPress',
  (event: any) => {
    if (PLACING_TOOLS.includes(toolStore.currentTool)) {
      // avoid bugs when starting a placing tool on an existing tool and right clicking and deleting existing tools
      return;
    }

    const withModifiers = !!(event.shiftKey || event.controlKey);
    const selectedData = view.widgetManager.getSelectedData();
    if ('widget' in selectedData) {
      const widget =
        selectedData.widget as Partial<vtkAnnotationToolWidget> | null;
      const widgetState = widget?.getWidgetState?.();
      if (!isAnnotationWidgetState(widgetState)) {
        if (!withModifiers) {
          selectionStore.clearSelection();
        }
        return;
      }

      const id = widgetState.getId();
      const type = widgetState.getToolType();
      // preserve if we've used shift or ctrl
      if (withModifiers) {
        selectionStore.toggleSelection(id, type);
      } else {
        selectionStore.clearSelection();
        selectionStore.addSelection(id, type);
      }
    } else if (!withModifiers) {
      // if no modifiers, then deselect
      selectionStore.clearSelection();
    }
  },
  {
    // capture all events by calling handler before widgets
    priority: WIDGET_PRIORITY + 1,
  }
);

const render = () => {};
</script>

<template>
  <render />
</template>
