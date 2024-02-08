<script setup lang="ts">
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useViewStore } from '@/src/store/views';
import { computed, toRefs } from 'vue';
import { WIDGET_PRIORITY } from '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants';
import { useToolSelectionStore } from '@/src/store/tools/toolSelection';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/types';
import type { vtkLPSViewProxy } from '@/src/types/vtk-types';

const props = defineProps<{
  viewId: string;
}>();

const { viewId } = toRefs(props);

const viewProxy = computed(() =>
  useViewStore().getViewProxy<vtkLPSViewProxy>(viewId.value)
);
const widgetManager = computed(() => viewProxy.value?.getWidgetManager());
const interactor = computed(() => viewProxy.value?.getInteractor());
const selectionStore = useToolSelectionStore();

onVTKEvent(
  interactor,
  'onLeftButtonPress',
  (event: any) => {
    if (!widgetManager.value) return;
    const withModifiers = !!(event.shiftKey || event.controlKey);
    const selectedData = widgetManager.value.getSelectedData();
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
