<template>
  <div class="vtk-container-wrapper" tabindex="0">
    <div class="vtk-gutter"></div>
    <div class="vtk-container">
      <div class="vtk-sub-container">
        <vtk-volume-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view"
          :view-id="id"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <template v-for="(sliceProps, idx) in obliqueSliceProps" :key="idx">
            <vtk-base-oblique-slice-representation
              :view-id="sliceProps.viewId"
              :image-id="currentImageID"
              :plane-normal="sliceProps.planeNormal"
              :plane-origin="sliceProps.planeOrigin"
            ></vtk-base-oblique-slice-representation>
            <vtk-image-outline-representation
              :view-id="sliceProps.viewId"
              :image-id="currentImageID"
              :plane-normal="sliceProps.planeNormal"
              :plane-origin="sliceProps.planeOrigin"
              :thickness="4"
              :color="sliceProps.outlineColor"
            ></vtk-image-outline-representation>
          </template>
          <slot></slot>
        </vtk-volume-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxis, LPSAxisDir } from '@/src/types/lps';
import VtkVolumeView from '@/src/components/vtk/VtkVolumeView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import { LayoutViewProps } from '@/src/types';
import VtkBaseObliqueSliceRepresentation from '@/src/components/vtk/VtkBaseObliqueSliceRepresentation.vue';
import VtkImageOutlineRepresentation from '@/src/components/vtk/VtkImageOutlineRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import useResliceCursorStore, {
  mapAxisToViewType,
} from '@/src/store/reslice-cursor';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { vec3 } from 'gl-matrix';
import { OBLIQUE_OUTLINE_COLORS } from '@/src/constants';
import { RGBColor } from '@kitware/vtk.js/types';

interface SliceSpec {
  viewID: string;
  axis: LPSAxis;
}

interface Props extends LayoutViewProps {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
  slices: SliceSpec[];
}

const vtkView = ref<VtkViewApi>();

const props = defineProps<Props>();

const {
  id: viewId,
  type: viewType,
  viewDirection,
  viewUp,
  slices,
} = toRefs(props);

useViewAnimationListener(vtkView, viewId, viewType);

// base image
const { currentImageID } = useCurrentImage();

// reslice cursor
const resliceStore = useResliceCursorStore();
const { resliceCursor, resliceCursorState } = resliceStore;

// -----

const resliceCenter = vtkFieldRef(resliceCursorState, 'center');
const obliqueSliceProps = computed(() => {
  return slices.value.map((sliceSpec) => {
    const planeNormal = resliceCursor.getPlaneNormalFromViewType(
      mapAxisToViewType(sliceSpec.axis)
    );
    const outlineColor = vec3.scale(
      [0, 0, 0],
      OBLIQUE_OUTLINE_COLORS[sliceSpec.viewID],
      1 / 255
    ) as RGBColor;
    return {
      viewId: sliceSpec.viewID,
      planeNormal,
      planeOrigin: resliceCenter.value,
      outlineColor,
    };
  });
});

// reset camera logic
function resetCamera() {
  if (!vtkView.value) return;
  vtkView.value.resetCamera();
  vtkView.value.requestRender();
}

useResetViewsEvents().onClick(resetCamera);
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
