<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useCineFrame } from '@/src/composables/useCineFrame';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { Maybe } from '@/src/types';
import vtkMouseRangeManipulator, {
  IMouseRangeManipulatorInitialValues,
} from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { syncRef } from '@vueuse/core';
import { inject, toRefs, unref, computed } from 'vue';
import { useViewStore } from '@/src/store/views';

type Props = {
  viewId: string;
  imageId: Maybe<string>;
  manipulatorConfig?: IMouseRangeManipulatorInitialValues;
};

const props = defineProps<Props>();
const { viewId, imageId, manipulatorConfig } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const interactorStyle =
  view.interactorStyle as Maybe<vtkInteractorStyleManipulator>;
if (!interactorStyle?.isA('vtkInteractorStyleManipulator')) {
  throw new Error('No vtkInteractorStyleManipulator');
}

const config = computed(() => ({
  button: 1,
  dragEnabled: false,
  scrollEnabled: true,
  ...manipulatorConfig?.value,
}));

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  config
);

const { frame, frameRange } = useCineFrame(viewId, imageId);

const scroll = useMouseRangeManipulatorListener(
  rangeManipulator,
  'scroll',
  frameRange,
  1,
  frame.value,
  -1,
  () => {
    useViewStore().setActiveView(unref(viewId));
  }
);

// scroll is initialized with frame.value; bidirectional syncRef keeps them
// aligned thereafter without paying for an immediate redundant write.
syncRef(scroll, frame);
</script>

<template><slot></slot></template>
