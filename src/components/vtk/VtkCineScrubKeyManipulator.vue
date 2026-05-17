<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useCineFrame } from '@/src/composables/useCineFrame';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { Maybe } from '@/src/types';
import vtkGatedMouseRangeManipulator from '@/src/vtk/GatedMouseRangeManipulator';
import { IMouseRangeManipulatorInitialValues } from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { syncRef, useMagicKeys } from '@vueuse/core';
import { inject, toRefs, unref, watch, computed } from 'vue';
import { useViewStore } from '@/src/store/views';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';

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
  button: -1,
  dragEnabled: false,
  scrollEnabled: false,
  ...manipulatorConfig?.value,
}));

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkGatedMouseRangeManipulator,
  config
);

rangeManipulator.value.setupMouseMove(view.interactor);

const keys = useMagicKeys();
const enableGrabSlice = computed(() => keys[actionToKey.value.grabSlice].value);
watch(
  enableGrabSlice,
  (value) => {
    rangeManipulator.value.setGateEnabled(value);
  },
  { immediate: true }
);

const { frame, frameRange } = useCineFrame(viewId, imageId);

const scroll = useMouseRangeManipulatorListener(
  rangeManipulator,
  'vertical',
  frameRange,
  1,
  frame.value,
  -1,
  () => {
    useViewStore().setActiveView(unref(viewId));
  }
);

syncRef(scroll, frame);
</script>

<template><slot></slot></template>
