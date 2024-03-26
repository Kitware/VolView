<script setup lang="ts">
import vtkCompositeMouseManipulator, {
  type ICompositeMouseManipulatorInitialValues,
} from '@kitware/vtk.js/Interaction/Manipulators/CompositeMouseManipulator';
import { useVtkInteractionManipulator } from '@/src/core/vtk/useVtkInteractionManipulator';
import { toRefs, inject, computed } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator';
import type { Maybe } from '@/src/types';
import type { VtkObjectConstructor } from '@/src/core/vtk/types';

interface Props {
  manipulatorConstructor: VtkObjectConstructor<vtkCompositeMouseManipulator>;
  manipulatorProps?: ICompositeMouseManipulatorInitialValues;
}

const props = defineProps<Props>();
const { manipulatorConstructor, manipulatorProps } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const interactorStyle =
  view.interactorStyle as Maybe<vtkInteractorStyleManipulator>;
if (!interactorStyle?.isA('vtkInteractorStyleManipulator')) {
  throw new Error('No vtkInteractorStyleManipulator');
}

const draggableManipulatorProps = computed(() => ({
  dragEnabled: true,
  ...manipulatorProps?.value,
}));

const { instance } = useVtkInteractionManipulator(
  interactorStyle,
  manipulatorConstructor,
  draggableManipulatorProps
);

defineExpose({
  manipulator: instance,
});
</script>

<template><slot></slot></template>
