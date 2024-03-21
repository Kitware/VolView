<template>
  <div class="vtk-container-wrapper" tabindex="0">
    <div class="vtk-gutter"></div>
    <div class="vtk-container">
      <div class="vtk-sub-container">
        <vtk-slice-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view"
          :view-id="id"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
          :slice-range="sliceDomain"
        >
          <vtk-base-oblique-slice-representation
            :view-id="id"
            :image-id="currentImageID"
            :plane-normal="planeNormal"
            :plane-origin="planeOrigin"
          ></vtk-base-oblique-slice-representation>
          <vtk-image-outline-representation
            :view-id="id"
            :image-id="currentImageID"
            :plane-normal="planeNormal"
            :plane-origin="planeOrigin"
            :thickness="4"
            :color="outlineColor"
          ></vtk-image-outline-representation>
          <reslice-cursor-tool
            :view-id="id"
            :view-direction="viewDirection"
          ></reslice-cursor-tool>
          <slot></slot>
        </vtk-slice-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import ResliceCursorTool from '@/src/components/tools/ResliceCursorTool.vue';
import VtkBaseObliqueSliceRepresentation from '@/src/components/vtk/VtkBaseObliqueSliceRepresentation.vue';
import VtkImageOutlineRepresentation from '@/src/components/vtk/VtkImageOutlineRepresentation.vue';
import VtkSliceView from '@/src/components/vtk/VtkSliceView.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { OBLIQUE_OUTLINE_COLORS } from '@/src/constants';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import useResliceCursorStore, {
  mapAxisToViewType,
} from '@/src/store/reslice-cursor';
import { LayoutViewProps } from '@/src/types';
import { LPSAxisDir } from '@/src/types/lps';
import { VtkViewApi } from '@/src/types/vtk-types';
import { batchForNextTask } from '@/src/utils/batchForNextTask';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { RGBColor } from '@kitware/vtk.js/types';
import { watchImmediate } from '@vueuse/core';
import { vec3 } from 'gl-matrix';
import { computed, ref, toRefs, watchEffect } from 'vue';

interface Props extends LayoutViewProps {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const vtkView = ref<VtkViewApi>();

const props = defineProps<Props>();

const { id: viewId, type: viewType, viewDirection, viewUp } = toRefs(props);
const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, viewType);

// base image
const { currentImageID, currentImageData, currentImageMetadata } =
  useCurrentImage();

// reslice cursor
const resliceStore = useResliceCursorStore();
const { resliceCursor, resliceCursorState } = resliceStore;

const widgetViewType = computed(() => mapAxisToViewType(viewAxis.value));

watchEffect(() => {
  if (currentImageData.value) {
    resliceCursor.setImage(currentImageData.value);
  }
});

// setup plane origin/normal
const planeOrigin = vtkFieldRef(resliceCursorState, {
  get: () => resliceCursorState.getCenter(),
  set: (v) => resliceCursor.setCenter(v),
});
const planes = vtkFieldRef(resliceCursorState, 'planes');
const planeNormal = computed(() => planes.value[widgetViewType.value].normal);

// slicing domain/range

// Function to compute float range of slicing for oblique slicing.
// Range is calculated as distance along the plane normal (as originating from {0,0,0} ).
function slicePlaneRange(
  cornerPoints: number[][],
  sliceNormal: number[]
): [number, number] {
  if (!cornerPoints || !sliceNormal) return [0, 1];

  // Get rotation matrix from normal to +X (since bounds is aligned to XYZ)
  const transform = vtkMatrixBuilder
    .buildFromDegree()
    .identity()
    .rotateFromDirections(sliceNormal, [1, 0, 0]);

  const corners = cornerPoints.map((x) => x.slice());
  corners.forEach((pt) => transform.apply(pt));

  // range is now maximum X distance
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = corners[i][0];
    if (x > maxX) {
      maxX = x;
    }
    if (x < minX) {
      minX = x;
    }
  }

  return [minX, maxX];
}

const imageCorners = computed(() => {
  const image = currentImageData.value;
  const [xmin, xmax, ymin, ymax, zmin, zmax] = image?.getExtent() ?? [
    0, 1, 0, 1, 0, 1,
  ];
  const corners = [
    [xmin, ymin, zmin],
    [xmax, ymin, zmin],
    [xmin, ymax, zmin],
    [xmax, ymax, zmin],
    [xmin, ymin, zmax],
    [xmax, ymin, zmax],
    [xmin, ymax, zmax],
    [xmax, ymax, zmax],
  ];
  corners.forEach((p) => image?.indexToWorld(p as vec3, p as vec3));
  return corners;
});

const sliceDomain = computed(() => {
  const [...sliceNormal] = planeNormal.value;
  const range = slicePlaneRange(imageCorners?.value, sliceNormal);
  return {
    min: range[0],
    max: range[1],
  };
});

// the core update camera function
const updateResliceCamera = (resetFocalPoint: boolean) => {
  if (!vtkView.value || !resliceCursorState.getImage()) return;
  resliceCursor.updateCameraPoints(
    vtkView.value.renderer,
    widgetViewType.value,
    resetFocalPoint,
    false,
    true
  );
};

// reset camera logic
function resetCamera() {
  if (!vtkView.value) return;

  const metadata = currentImageMetadata.value;
  resliceStore.resetReslicePlanes(metadata);

  const { worldBounds } = metadata;
  planeOrigin.value = vtkBoundingBox.getCenter(worldBounds);
  resliceCursorState.placeWidget(worldBounds);

  vtkView.value.resetCamera();
  updateResliceCamera(false);

  vtkView.value.requestRender();
}

useResetViewsEvents().onClick(resetCamera);

// update the camera
onVTKEvent(
  resliceCursorState,
  'onModified',
  batchForNextTask(() => {
    updateResliceCamera(false);
  })
);

watchImmediate(currentImageID, () => {
  updateResliceCamera(true);
});

// slicing plane colors
const outlineColor = computed(
  () =>
    vec3.scale(
      [0, 0, 0],
      OBLIQUE_OUTLINE_COLORS[viewId.value],
      1 / 255
    ) as RGBColor
);
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
