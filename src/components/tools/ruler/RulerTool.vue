<template>
  <annotation-tool
    :view-id="viewId"
    :current-slice="currentSlice"
    :view-direction="viewDirection"
    :widget-manager="widgetManager"
    :tool-store="toolStore"
    :svg-component="svgComponent"
  />
</template>

<script setup lang="ts">
import AnnotationTool from '@/src/components/tools/AnnotationTool.vue';
import { useRulerStore } from '@/src/store/tools/rulers';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { LPSAxisDir } from '@/src/types/lps';
import RulerSVG2D from './RulerSVG2D.vue';

defineProps<{
  viewId: string;
  currentSlice: number;
  viewDirection: LPSAxisDir;
  widgetManager: vtkWidgetManager;
}>();

const toolStore = useRulerStore();
const svgComponent = RulerSVG2D;
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
