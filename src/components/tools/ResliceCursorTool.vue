<script setup lang="ts">
import { computed, inject, ref, toRefs } from 'vue';
import { vtkResliceCursorWidgetDefaultInstance } from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget/behavior';
import { vtkColor3MixinState } from '@kitware/vtk.js/Widgets/Core/StateBuilder/color3Mixin';
import { vtkScale1MixinState } from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin';
import { vtkScale3MixinState } from '@kitware/vtk.js/Widgets/Core/StateBuilder/scale3Mixin';

// The reslice cursor builds its sphere handles from the color3/scale1 mixins
// and its line handles from the color3/scale3 mixins.
type SphereHandleState = vtkColor3MixinState & vtkScale1MixinState;
type LineHandleState = vtkColor3MixinState & vtkScale3MixinState;
// Per-axis label queries mix line handles (scale3) with rotation handles
// (scale1), so only the color3 mixin is common to every result.
type ColoredHandleState = vtkColor3MixinState;
import { OBLIQUE_OUTLINE_COLORS } from '@/src/constants';
import { getLPSAxisFromDir, getVTKViewTypeFromLPSAxis } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import useResliceCursorStore from '@/src/store/reslice-cursor';
import { VtkViewContext } from '@/src/components/vtk/context';
import { onViewMounted, onViewUnmounted } from '@/src/core/vtk/onViewMounted';
import { InitViewIDs } from '@/src/config';

interface Props {
  viewId: string;
  viewDirection: LPSAxisDir;
}

const props = defineProps<Props>();
const { viewDirection } = toRefs(props);
const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

const view = inject(VtkViewContext);
if (!view) throw new Error('No vtk view');

const resliceCursorStore = useResliceCursorStore();
const { resliceCursor, resliceCursorState } = resliceCursorStore;

const widget = ref<vtkResliceCursorWidgetDefaultInstance>();
const vtkViewType = computed(() => getVTKViewTypeFromLPSAxis(viewAxis.value));

onViewMounted(view.renderWindowView, () => {
  widget.value = view.widgetManager.addWidget(
    resliceCursor,
    vtkViewType.value
  ) as vtkResliceCursorWidgetDefaultInstance;

  widget.value.setKeepOrthogonality(true);
  // reset mouse cursor styles
  widget.value.setCursorStyles({
    translateCenter: 'default',
    rotateLine: 'default',
    translateAxis: 'default',
  });

  resliceCursorState.getStatesWithLabel('sphere').forEach((handle) => {
    const h = handle as SphereHandleState;
    h.setScale1(10);
    h.setOpacity(128);
  });

  resliceCursorState.getStatesWithLabel('line').forEach((handle) => {
    const h = handle as LineHandleState;
    h.setScale3(1, 1, 1);
    h.setOpacity(100);
  });

  const xLines = [
    ...resliceCursorState.getStatesWithLabel('XinZ'),
    ...resliceCursorState.getStatesWithLabel('XinY'),
  ];
  xLines.forEach((handle) => {
    const h = handle as ColoredHandleState;
    h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueSagittal]);
  });

  const yLines = [
    ...resliceCursorState.getStatesWithLabel('YinZ'),
    ...resliceCursorState.getStatesWithLabel('YinX'),
  ];
  yLines.forEach((handle) => {
    const h = handle as ColoredHandleState;
    h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueCoronal]);
  });

  const zLines = [
    ...resliceCursorState.getStatesWithLabel('ZinX'),
    ...resliceCursorState.getStatesWithLabel('ZinY'),
  ];
  zLines.forEach((handle) => {
    const h = handle as ColoredHandleState;
    h.setColor3(OBLIQUE_OUTLINE_COLORS[InitViewIDs.ObliqueAxial]);
  });

  // update representation to not be as 3D
  widget.value.getRepresentations().forEach((rep) => {
    rep.getActors().forEach((actor) => {
      actor.getProperty().setAmbient(1);
    });
  });

  view.requestRender();
});

onViewUnmounted(view.renderWindowView, () => {
  widget.value = undefined;
  view.widgetManager.removeWidget(resliceCursor);
});
</script>

<template>
  <div></div>
</template>
