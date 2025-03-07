<script setup lang="ts">
import { VtkViewContext } from '@/src/components/vtk/context';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSliceConfigInitializer } from '@/src/composables/useSliceConfigInitializer';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { Maybe } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import vtkGatedMouseRangeManipulator from '@/src/vtk/GatedMouseRangeManipulator';
import { IMouseRangeManipulatorInitialValues } from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import { syncRef, useMagicKeys } from '@vueuse/core';
import { inject, toRefs, unref, watch, computed, watchPostEffect } from 'vue';
import { useViewStore } from '@/src/store/views';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
  viewDirection: LPSAxisDir;
  manipulatorConfig?: IMouseRangeManipulatorInitialValues;
}

const props = defineProps<Props>();
const { viewId, imageId, viewDirection, manipulatorConfig } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const interactorStyle =
  view.interactorStyle as Maybe<vtkInteractorStyleManipulator>;
if (!interactorStyle?.isA('vtkInteractorStyleManipulator')) {
  throw new Error('No vtkInteractorStyleManipulator');
}

const config = computed(() => {
  return {
    button: -1,
    dragEnabled: false,
    scrollEnabled: false,
    ...manipulatorConfig?.value,
  };
});

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkGatedMouseRangeManipulator,
  config
);

// run after useWebGLRenderWindow assigns the container
watchPostEffect(() => {
  const container = view.renderWindowView.getContainer();
  rangeManipulator.value.initializeGlobalMouseMove(
    view.renderWindow.getInteractor(),
    view.renderer,
    container
  );
});

const keys = useMagicKeys();
const enableGrabSlice = computed(() => keys[actionToKey.value.grabSlice].value);
watch(
  enableGrabSlice,
  (value) => {
    rangeManipulator.value.setGateEnabled(value);
  },
  { immediate: true }
);

const sliceConfig = useSliceConfig(viewId, imageId);
useSliceConfigInitializer(viewId, imageId, viewDirection);

const scroll = useMouseRangeManipulatorListener(
  rangeManipulator,
  'vertical',
  sliceConfig.range,
  1,
  sliceConfig.slice.value
);

watch(scroll, () => {
  const viewStore = useViewStore();
  if (unref(viewId) !== viewStore.activeViewID) {
    viewStore.setActiveViewID(unref(viewId));
  }
});

syncRef(scroll, sliceConfig.slice, { immediate: true });
</script>

<template><slot></slot></template>
