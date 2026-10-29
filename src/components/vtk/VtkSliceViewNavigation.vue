<script setup lang="ts">
import { storeToRefs } from 'pinia';
import vtkMouseCameraTrackballPanManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator';
import vtkMouseCameraTrackballZoomToMouseManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator';
import VtkMouseInteractionManipulator from '@/src/components/vtk/VtkMouseInteractionManipulator.vue';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';

defineProps<{ scrollZoom?: boolean }>();
const { currentTool } = storeToRefs(useToolStore());
</script>

<template>
  <vtk-mouse-interaction-manipulator
    v-if="currentTool === Tools.Pan"
    :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
    :manipulator-props="{ button: 1 }"
  />
  <vtk-mouse-interaction-manipulator
    :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
    :manipulator-props="{ button: 1, shift: true }"
  />
  <vtk-mouse-interaction-manipulator
    :manipulator-constructor="vtkMouseCameraTrackballPanManipulator"
    :manipulator-props="{ button: 2 }"
  />
  <vtk-mouse-interaction-manipulator
    v-if="currentTool === Tools.Zoom"
    :manipulator-constructor="vtkMouseCameraTrackballZoomToMouseManipulator"
    :manipulator-props="{ button: 1 }"
  />
  <vtk-mouse-interaction-manipulator
    :manipulator-constructor="vtkMouseCameraTrackballZoomToMouseManipulator"
    :manipulator-props="{ button: 3, scrollEnabled: !!scrollZoom }"
  />
</template>
