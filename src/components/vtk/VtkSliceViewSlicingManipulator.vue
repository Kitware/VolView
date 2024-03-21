<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSliceConfigInitializer } from '@/src/composables/useSliceConfigInitializer';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import vtkMouseRangeManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { syncRef } from '@vueuse/core';
import { inject, toRefs } from 'vue';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
}

const props = defineProps<Props>();
const { viewId, imageId, viewDirection } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const interactorStyle =
  view.interactorStyle as Maybe<vtkInteractorStyleManipulator>;
if (!interactorStyle?.isA('vtkInteractorStyleManipulator')) {
  throw new Error('No vtkInteractorStyleManipulator');
}

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  { button: 1, dragEnabled: false, scrollEnabled: true }
);

const sliceConfig = useSliceConfig(viewId, imageId);
useSliceConfigInitializer(viewId, imageId, viewDirection);

const scroll = useMouseRangeManipulatorListener(
  rangeManipulator,
  'scroll',
  sliceConfig.range,
  1,
  sliceConfig.slice.value
);

syncRef(scroll, sliceConfig.slice, { immediate: true });
</script>

<template><slot></slot></template>
