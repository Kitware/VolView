<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainer" />
      </div>
    </div>
  </div>
</template>

<script>
import {
  ref,
  toRefs,
  watch,
  unref,
  reactive,
  watchEffect,
  computed,
} from '@vue/composition-api';

import {
  CommonViewProps,
  useVtkView,
  useVtkViewCameraOrientation,
  giveViewAnnotations,
} from '@/src/composables/view/common';
import { useResizeObserver } from '@/src/composables/resizeObserver';
import { watchScene, watchColorBy } from '@/src/composables/scene';
import { useComputedState } from '@/src/composables/store';
import { useProxyManager } from '@/src/composables/proxyManager';

export default {
  name: 'VtkThreeView',
  props: CommonViewProps,
  setup(props) {
    const { viewName, viewType, viewUp, axis, orientation } = toRefs(props);
    const vtkContainer = ref(null);

    const pxm = useProxyManager();

    const {
      sceneSources,
      worldOrientation,
      colorBy,
      boundsWithSpacing,
      baseImageColorPreset,
      baseImage,
      slices,
      windowing,
    } = useComputedState({
      sceneSources(state, getters) {
        const { pipelines } = state.visualization;
        return getters.sceneObjectIDs
          .filter((id) => id in pipelines)
          .map((id) => pipelines[id].last);
      },
      worldOrientation: (state) => state.visualization.worldOrientation,
      colorBy: (state, getters) =>
        getters.sceneObjectIDs.map((id) => state.visualization.colorBy[id]),
      boundsWithSpacing: (_, getters) =>
        getters['visualization/boundsWithSpacing'],
      baseImageColorPreset: (_, getters) =>
        getters['visualization/baseImageColorPreset'],
      baseImage(state) {
        const { pipelines } = state.visualization;
        const { selectedBaseImage } = state;
        if (selectedBaseImage in pipelines) {
          return pipelines[selectedBaseImage].last;
        }
        return null;
      },
      slices: (state) => state.visualization.slices,
      windowing: (state) => state.visualization.windowing,
    });

    const spacing = computed(() => worldOrientation.value.spacing);

    const viewRef = useVtkView({
      containerRef: vtkContainer,
      viewName,
      viewType,
    });

    // handle camera orientation
    useVtkViewCameraOrientation(viewRef, viewUp, axis, orientation);

    useResizeObserver(vtkContainer, () => {
      const view = unref(viewRef);
      if (view) {
        view.resize();
      }
    });

    // update scene sources and their colors
    watchScene(sceneSources, worldOrientation, viewRef);
    watchColorBy(colorBy, sceneSources, viewRef);

    // prepare view
    watchEffect(() => {
      const view = unref(viewRef);
      if (view) {
        view.setBackground(0.1, 0.2, 0.3);
        view.setOrientationAxesType('cube');
      }
    });

    // set wl and slices
    watchEffect(() => {
      if (viewRef.value && baseImage.value) {
        const rep = pxm.getRepresentation(baseImage.value, viewRef.value);
        if (rep) {
          rep.setXSlice(slices.value.x * spacing.value[0]);
          rep.setYSlice(slices.value.y * spacing.value[1]);
          rep.setZSlice(slices.value.z * spacing.value[2]);
          rep.setWindowWidth(windowing.value.width);
          rep.setWindowLevel(windowing.value.level);
        }
      }
    });

    // reset camera whenever bounds changes
    watch(boundsWithSpacing, () => {
      const view = unref(viewRef);
      if (view) {
        view.resetCamera();
      }
    });

    giveViewAnnotations(
      viewRef,
      reactive({
        nw: baseImageColorPreset,
      }),
      {
        nw: 'No colormap',
      }
    );

    return {
      vtkContainer, // dom ref
      active: true,
    };
  },
};
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>

<style scoped>
.vtk-gutter {
  display: flex;
  flex-flow: column;
}
</style>
