<script setup lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { WIDGET_PRIORITY } from '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/types';
import { inject } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const selectionStore = useToolSelectionStore();

onVTKEvent(
  view.interactor,
  'onLeftButtonPress',
  (event: any) => {
    const withModifiers = !!(event.shiftKey || event.controlKey);
    const selectedData = view.widgetManager.getSelectedData();
    if ('widget' in selectedData) {
      // clicked in empty space.
      const widget = selectedData.widget as vtkAnnotationToolWidget;
      const widgetState = widget.getWidgetState();
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
