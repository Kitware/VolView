<script setup lang="ts">
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useMouseRangeManipulatorListener } from '@/src/core/vtk/useMouseRangeManipulatorListener';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { Maybe } from '@/src/types';
import vtkMouseRangeManipulator, {
  IMouseRangeManipulatorInitialValues,
} from '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import type { Vector2 } from '@kitware/vtk.js/types';
import { inject, toRefs, computed, watch } from 'vue';

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

const config = computed(() => {
  return {
    button: 1,
    dragEnabled: true,
    scrollEnabled: false,
    ...manipulatorConfig?.value,
  };
});

const { instance: rangeManipulator } = useVtkInteractionManipulator(
  interactorStyle,
  vtkMouseRangeManipulator,
  config
);

const wlConfig = useWindowingConfig(viewId, imageId);
useResetViewsEvents().onClick(() => {
  useWindowingStore().resetConfig(wlConfig.viewID.value, imageId.value);
});

const computeStep = (range: Vector2) => {
  const diff = range[1] - range[0] || 1;
  return Math.min(diff, 1) / 256;
};

const wlStep = computed(() => computeStep(wlConfig.range.value));
const widthRange = computed((): Vector2 => {
  const [min, max] = wlConfig.range.value;
  return [1e-12, Math.max(1e-12, max - min || 1)];
});

for (const [direction, field, range] of [
  ['horizontal', 'level', wlConfig.range],
  ['vertical', 'width', widthRange],
] as const) {
  const value = useMouseRangeManipulatorListener(
    rangeManipulator,
    direction,
    range,
    wlStep,
    wlConfig[field].value,
    1,
    () => {
      wlConfig[field].value = value.value;
    }
  );
  watch(
    wlConfig[field],
    (incoming) => {
      value.value = incoming;
    },
    { flush: 'sync' }
  );
}
</script>

<template><slot></slot></template>
