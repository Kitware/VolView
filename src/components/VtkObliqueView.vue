<template>
  <div
    class="vtk-container-wrapper-oblique"
    tabindex="0"
    @pointerenter="hover = true"
    @pointerleave="hover = false"
    @focusin="hover = true"
    @focusout="hover = false"
  >
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <div class="overlay-no-events tool-layer" ref="toolContainer">
        <pan-tool :view-id="viewID" />
        <zoom-tool :view-id="viewID" />
        <reslice-cursor-tool
          :view-id="viewID"
          :view-direction="viewDirection"
        />
        <window-level-tool :view-id="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:bottom-left>
          <div class="annotation-cell">
            <div v-if="windowWidth != null && windowLevel != null">
              W/L: {{ windowWidth.toFixed(2) }} / {{ windowLevel.toFixed(2) }}
            </div>
          </div>
        </template>
        <template v-slot:top-right>
          <div class="annotation-cell">
            <dicom-quick-info-button
              :image-id="curImageID"
            ></dicom-quick-info-button>
          </div>
        </template>
      </view-overlay-grid>
      <transition name="loading">
        <div v-if="isImageLoading" class="overlay-no-events loading">
          <div>Loading the image</div>
          <div>
            <v-progress-circular indeterminate color="blue" />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  onBeforeMount,
  onBeforeUnmount,
  onMounted,
  PropType,
  provide,
  ref,
  toRefs,
  watch,
  watchEffect,
} from 'vue';
import { vec3 } from 'gl-matrix';
import { onKeyStroke } from '@vueuse/core';

import type { RGBColor, Vector3 } from '@kitware/vtk.js/types';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkResliceRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/ResliceRepresentationProxy';
import { useResizeToFit } from '@/src/composables/useResizeToFit';
import vtkLPSView2DProxy from '@/src/vtk/LPSView2DProxy';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';
import { ResliceCursorWidgetState } from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { manageVTKSubscription } from '@/src/composables/manageVTKSubscription';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useSliceConfigInitializer } from '@/src/composables/useSliceConfigInitializer';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import { useWindowingConfigInitializer } from '@/src/composables/useWindowingConfigInitializer';
import { useProxyRepresentation } from '@/src/composables/useProxyRepresentations';
import DicomQuickInfoButton from '@/src/components/DicomQuickInfoButton.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSAxisFromDir } from '../utils/lps';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import WindowLevelTool from './tools/windowing/WindowLevelTool.vue';
import PanTool from './tools/PanTool.vue';
import ZoomTool from './tools/ZoomTool.vue';
import ResliceCursorTool from './tools/ResliceCursorTool.vue';
import { useResetViewsEvents } from './tools/ResetViews.vue';
import { LPSAxisDir } from '../types/lps';
import { ViewProxyType } from '../core/proxies';
import { useViewProxy } from '../composables/useViewProxy';
import { useWidgetManager } from '../composables/useWidgetManager';
import useViewSliceStore from '../store/view-configs/slicing';
import {
  OBLIQUE_OUTLINE_COLORS,
  ToolContainer,
  VTKTwoViewWidgetManager,
  VTKResliceCursor,
} from '../constants';

const SLICE_OFFSET_KEYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowDown: 1,
} as const;

export default defineComponent({
  name: 'VtkObliqueView',
  props: {
    id: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    viewUp: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
  },
  components: {
    ViewOverlayGrid,
    WindowLevelTool,
    PanTool,
    ZoomTool,
    ResliceCursorTool,
    DicomQuickInfoButton,
  },
  setup(props) {
    const viewSliceStore = useViewSliceStore();

    const { id: viewID, viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();

    const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

    // --- computed vars --- //

    const {
      currentImageData: curImageData,
      currentImageID: curImageID,
      currentImageMetadata: curImageMetadata,
      isImageLoading,
    } = useCurrentImage();

    const { slice: currentSlice, config: sliceConfig } = useSliceConfig(
      viewID,
      curImageID
    );
    const {
      width: windowWidth,
      level: windowLevel,
      config: wlConfig,
    } = useWindowingConfig(viewID, curImageID);

    // --- view proxy setup --- //

    const { viewProxy } = useViewProxy<vtkLPSView2DProxy>(
      viewID,
      ViewProxyType.Oblique
    );

    const resliceCursor = inject(VTKResliceCursor);
    if (!resliceCursor) {
      throw Error('Cannot access global ResliceCursor instance.');
    }

    const VTKViewType = computed(() => {
      const viewAxisValue = viewAxis?.value;
      switch (viewAxisValue) {
        case 'Coronal':
          return ViewTypes.XZ_PLANE;
        case 'Sagittal':
          return ViewTypes.YZ_PLANE;
        default:
          return ViewTypes.XY_PLANE;
      }
    });

    const { representation: baseImageRep } =
      useProxyRepresentation<vtkResliceRepresentationProxy>(curImageID, viewID);

    onBeforeMount(() => {
      // do this before mount, as the ManipulatorTools run onMounted
      // before this component does.
      viewProxy.value.getInteractorStyle2D().removeAllManipulators();
    });

    const updateViewFromResliceCursor = () => {
      const rep = baseImageRep?.value;
      const state = resliceCursor?.getWidgetState() as ResliceCursorWidgetState;
      if (resliceCursor && rep) {
        const planeOrigin = state.getCenter();
        const planeNormal = resliceCursor.getPlaneNormalFromViewType(
          VTKViewType.value
        );
        rep.getSlicePlane().setNormal(planeNormal);
        rep.getSlicePlane().setOrigin(planeOrigin);
        if (curImageData.value) {
          resliceCursor.updateCameraPoints(
            viewProxy.value.getRenderer(),
            VTKViewType.value,
            false,
            false,
            true
          );
        }
      }
    };

    onVTKEvent(
      resliceCursor.getWidgetState(),
      'onModified',
      updateViewFromResliceCursor
    );

    onMounted(() => {
      viewProxy.value.setContainer(vtkContainerRef.value ?? null);
      viewProxy.value.setOrientationAxesVisibility(false);

      // Initialize camera points during construction
      if (curImageData.value) {
        resliceCursor.updateCameraPoints(
          viewProxy.value.getRenderer(),
          VTKViewType.value,
          true,
          false,
          true
        );
      }
    });

    onBeforeUnmount(() => {
      viewProxy.value.setContainer(null);
    });

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

    // --- arrows change slice --- //

    const hover = ref(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!curImageID.value || !hover.value) return;

      const sliceOffset = SLICE_OFFSET_KEYS[event.key] ?? 0;
      if (sliceOffset) {
        viewSliceStore.updateConfig(viewID.value, curImageID.value, {
          slice: currentSlice.value + sliceOffset,
        });

        event.stopPropagation();
      }
    };
    onKeyStroke(Object.keys(SLICE_OFFSET_KEYS), onKeyDown);

    // --- resizing --- //

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    // Used by SVG tool widgets for resizeCallback
    const toolContainer = ref<HTMLElement>();
    provide(ToolContainer, toolContainer);

    // --- widget manager --- //

    const { widgetManager } = useWidgetManager(viewProxy);
    provide(VTKTwoViewWidgetManager, widgetManager);

    // --- window/level setup --- //

    watch(
      curImageData,
      (imageData) => {
        if (curImageID.value == null || wlConfig.value != null || !imageData) {
          return;
        }

        updateViewFromResliceCursor();
      },
      {
        immediate: true,
      }
    );

    // --- scene setup --- //

    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      curImageMetadata
    );

    const imageCorners = computed(() => {
      const image = curImageData.value;
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
      const [...sliceNormal] = cameraDirVec?.value ?? [0, 0, 1];
      const range = slicePlaneRange(imageCorners?.value, sliceNormal);
      return {
        min: range[0],
        max: range[1],
      };
    });

    // --- apply windowing and slice configs --- //

    useSliceConfigInitializer(viewID, curImageID, viewDirection, sliceDomain);
    useWindowingConfigInitializer(viewID, curImageID);

    watch(
      baseImageRep,
      (obliqueRep) => {
        if (obliqueRep) {
          obliqueRep.setOutlineVisibility(true);
          obliqueRep.setOutlineLineWidth(4.0);
          if (viewID.value) {
            const outlineColor = vec3.scale(
              [0, 0, 0],
              OBLIQUE_OUTLINE_COLORS[viewID.value],
              1 / 255
            ) as RGBColor;
            obliqueRep.setOutlineColor(outlineColor);
          }
        }
      },
      { immediate: true }
    );

    // Set default cutting plane parameters.

    watch([baseImageRep, cameraDirVec], () => {
      const rep = baseImageRep?.value;
      if (rep) {
        if (cameraDirVec) {
          const planeNormal: Vector3 = [
            cameraDirVec.value[0],
            cameraDirVec.value[1],
            cameraDirVec.value[2],
          ];
          rep.getSlicePlane().setNormal(planeNormal);
        }
        rep.setSlabType(SlabTypes.MAX);
        rep.setSlabThickness(1);
      }
    });

    // --- camera setup --- //

    const { resizeToFit, ignoreResizeToFitTracking, resetResizeToFitTracking } =
      useResizeToFit(viewProxy.value.getCamera(), false);

    const resizeToFitScene = () =>
      ignoreResizeToFitTracking(() => {
        // resize to fit
        const lookAxis =
          curImageMetadata.value.lpsOrientation[
            getLPSAxisFromDir(viewDirection.value)
          ];
        const upAxis =
          curImageMetadata.value.lpsOrientation[
            getLPSAxisFromDir(viewUp.value)
          ];
        const dimsWithSpacing = curImageMetadata.value.dimensions.map(
          (d, i) => d * curImageMetadata.value.spacing[i]
        );
        viewProxy.value.resizeToFit(lookAxis, upAxis, dimsWithSpacing);
        resetResizeToFitTracking();
      });

    const resetCamera = () => {
      const bounds = curImageMetadata.value.worldBounds;
      const center = vtkBoundingBox.getCenter(bounds);

      // do not track resizeToFit state
      ignoreResizeToFitTracking(() => {
        viewProxy.value.updateCamera(
          cameraDirVec.value,
          cameraUpVec.value,
          center
        );
        viewProxy.value.resetCamera(bounds);
        // reset cursor widget
        const state =
          resliceCursor?.getWidgetState() as ResliceCursorWidgetState;
        // Reset to default plane values before transforming based on current image-data.
        state.setPlanes({
          [ViewTypes.YZ_PLANE]: {
            normal: [1, 0, 0],
            viewUp: [0, 0, 1],
          },
          [ViewTypes.XZ_PLANE]: {
            normal: [0, -1, 0],
            viewUp: [0, 0, 1],
          },
          [ViewTypes.XY_PLANE]: {
            normal: [0, 0, -1],
            viewUp: [0, -1, 0],
          },
        });
        const planes = state.getPlanes();

        if (curImageMetadata.value) {
          planes[ViewTypes.XY_PLANE].normal = curImageMetadata.value
            .lpsOrientation.Inferior as Vector3;
          planes[ViewTypes.XY_PLANE].viewUp = curImageMetadata.value
            .lpsOrientation.Anterior as Vector3;

          planes[ViewTypes.XZ_PLANE].normal = curImageMetadata.value
            .lpsOrientation.Anterior as Vector3;
          planes[ViewTypes.XZ_PLANE].viewUp = curImageMetadata.value
            .lpsOrientation.Superior as Vector3;

          planes[ViewTypes.YZ_PLANE].normal = curImageMetadata.value
            .lpsOrientation.Left as Vector3;
          planes[ViewTypes.YZ_PLANE].viewUp = curImageMetadata.value
            .lpsOrientation.Superior as Vector3;

          resliceCursor.setCenter(center);
        }
        if (curImageMetadata) {
          state.placeWidget(bounds);
        }
        viewProxy.value.renderLater();
      });

      resizeToFitScene();

      updateViewFromResliceCursor();

      viewProxy.value.renderLater();
    };

    manageVTKSubscription(
      viewProxy.value.onResize(() => {
        if (resizeToFit.value) {
          resizeToFitScene();
        }
      })
    );

    // if we re-enable resizeToFit, reset the camera
    watch(resizeToFit, () => {
      if (resizeToFit.value) {
        resetCamera();
      }
    });

    watch(
      [curImageID, cameraDirVec, cameraUpVec],
      () => {
        // If we have a saved camera configuration restore it
        if (resizeToFit.value) {
          resetCamera();
        } else {
          // this will trigger a resetCamera() call
          resizeToFit.value = true;
        }
      },
      { immediate: true, deep: true }
    );

    // --- viewport orientation/camera labels --- //

    watchEffect(() => {
      if (sliceConfig.value == null || wlConfig.value == null) {
        return;
      }

      const { width, level } = wlConfig.value;

      if (baseImageRep.value) {
        baseImageRep.value.setWindowWidth(width);
        baseImageRep.value.setWindowLevel(level);
      }

      viewProxy.value.renderLater();
    });

    // Listen to ResetViews event.
    const events = useResetViewsEvents();
    events.onClick(() => resetCamera());

    const enableResizeToFit = () => {
      resizeToFit.value = true;
      resetCamera();
    };

    return {
      vtkContainerRef,
      toolContainer,
      viewID,
      viewProxy,
      viewAxis,
      active: true,
      curImageID,
      currentSlice,
      windowWidth,
      windowLevel,
      isImageLoading,
      widgetManager,
      enableResizeToFit,
      hover,
    };
  },
  mounted() {
    this.enableResizeToFit();
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>
<style scoped>
.hover-info {
  width: 32px;
  height: 32px;
  cursor: pointer;
}
.vtk-container-wrapper-oblique {
  flex: 1;
  display: grid;
  grid-template-columns: auto;
  grid-template-rows: auto;
  z-index: 0; /* avoids partial obscuring of focus outline */
}
</style>
