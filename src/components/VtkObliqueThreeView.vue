<template>
  <div class="vtk-container-wrapper vtk-three-container">
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div
          class="vtk-view"
          ref="vtkContainerRef"
          data-testid="vtk-view vtk-three-view"
        />
      </div>
      <div class="overlay-no-events tool-layer">
        <pan-tool :viewId="viewID" />
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <v-btn
              class="pointer-events-all"
              dark
              icon
              size="medium"
              variant="text"
              @click="resetCamera"
            >
              <v-icon size="medium" class="py-1">
                mdi-camera-flip-outline
              </v-icon>
              <v-tooltip
                location="right"
                activator="parent"
                transition="slide-x-transition"
              >
                Reset Camera
              </v-tooltip>
            </v-btn>
          </div>
        </template>
      </view-overlay-grid>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
} from 'vue';

import { vec3 } from 'gl-matrix';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import { ResliceCursorWidgetState } from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';
import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager/Constants';

import vtkMultiSliceRepresentationProxy, { OutlineProperties } from '@/src/vtk/MultiSliceRepresentationProxy';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import PanTool from './tools/PanTool.vue';
import { LPSAxisDir } from '../types/lps';
import { useViewProxy } from '../composables/useViewProxy';
import vtkLPSView3DProxy from '../vtk/LPSView3DProxy';
import { ViewProxyType } from '../core/proxies';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import { InitViewIDs } from '../config';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useResetViewsEvents } from './tools/ResetViews.vue';
import { VTKResliceCursor, OBLIQUE_OUTLINE_COLORS } from '../constants';
import { useSceneBuilder } from '../composables/useSceneBuilder';
import useWindowingStore from '../store/view-configs/windowing';

export default defineComponent({
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
    PanTool,
  },
  setup(props) {
    const { id: viewID, viewDirection, viewUp } = toRefs(props);
    const vtkContainerRef = ref<HTMLElement>();

    // --- computed vars --- //
    const { currentImageData, currentImageID, currentImageMetadata } = useCurrentImage();

    // --- view proxy setup --- //

    const { viewProxy, setContainer: setViewProxyContainer } =
      useViewProxy<vtkLPSView3DProxy>(viewID, ViewProxyType.Oblique3D);

    const { baseImageRep } = useSceneBuilder<vtkMultiSliceRepresentationProxy>(viewID, {
      baseImage: currentImageID
    });

    // --- Set the data and slice outline properties --- //
    const setOutlineProperties = () => {
      const outlineColors =
      [InitViewIDs.ObliqueSagittal, InitViewIDs.ObliqueCoronal, InitViewIDs.ObliqueAxial]
      .map(v =>
        vec3.scale(
          [0, 0, 0],
          OBLIQUE_OUTLINE_COLORS[v],
          1/255
        )
      );

      const outlineProperties = outlineColors.map(color => ({color, lineWidth: 4, opacity: 1.0}) as OutlineProperties);
      baseImageRep.value?.setSliceOutlineProperties(outlineProperties);
      baseImageRep.value?.setDataOutlineProperties({lineWidth: 1, opacity: 0.3} as OutlineProperties);
    }

    onBeforeUnmount(() => {
      setViewProxyContainer(null);
      viewProxy.value.setContainer(null);
    });

    onMounted(() => {
      viewProxy.value.setOrientationAxesVisibility(true);
      viewProxy.value.setOrientationAxesType('cube');
      viewProxy.value.setBackground([0, 0, 0, 0]);
      viewProxy.value.getCamera().setParallelProjection(true);
      setViewProxyContainer(vtkContainerRef.value);
    });

    const resliceCursorRef = inject(VTKResliceCursor);
    if (!resliceCursorRef) {
      throw Error('Cannot access global ResliceCursor instance.');
    }

    const updateViewFromResliceCursor = () => {
      const rep = baseImageRep?.value;
      const resliceCursor = resliceCursorRef?.value;
      const state = resliceCursor?.getWidgetState() as ResliceCursorWidgetState;
      const planeOrigin = state?.getCenter();
      if (resliceCursor && rep && planeOrigin) {
        const planeNormalYZ = resliceCursor.getPlaneNormalFromViewType(ViewTypes.YZ_PLANE);
        const planeNormalXZ = resliceCursor.getPlaneNormalFromViewType(ViewTypes.XZ_PLANE);
        const planeNormalXY = resliceCursor.getPlaneNormalFromViewType(ViewTypes.XY_PLANE);
        const planesForSlices = [
          {origin: planeOrigin, normal: planeNormalYZ},
          {origin: planeOrigin, normal: planeNormalXZ},
          {origin: planeOrigin, normal: planeNormalXY},
        ];
        rep.setPlanes(planesForSlices);
      }
    }

    const onPlanesUpdated = () => {
      updateViewFromResliceCursor();
      viewProxy.value.renderLater();
    };

    onVTKEvent(resliceCursorRef.value.getWidgetState(), 'onModified', onPlanesUpdated);

    // --- camera setup --- //

    const { cameraUpVec, cameraDirVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      currentImageMetadata
    );

    useResizeObserver(vtkContainerRef, () => viewProxy.value.resize());

    const resetCamera = () => {
      const bounds = currentImageMetadata.value.worldBounds;
      const center = vtkBoundingBox.getCenter(bounds);

      viewProxy.value.updateCamera(
        cameraDirVec.value,
        cameraUpVec.value,
        center
      );
      viewProxy.value.resetCamera();
      viewProxy.value.renderLater();
    };

    // Listen to ResetViews event.
    const events = useResetViewsEvents();
    events.onClick(() => resetCamera());

    watch([baseImageRep, currentImageData],
      () => {
        setOutlineProperties();
        resetCamera();
      },
      { immediate: true }
    );

    // Track window-level setting of one of the oblique views:
    const windowingStore = useWindowingStore();
    const wlConfig = computed(() => windowingStore.getConfig(InitViewIDs.ObliqueAxial, currentImageID.value));

    watch([wlConfig, baseImageRep], ([newConfigValue, newRep]) => {
      if (newConfigValue && newRep) {
        const { width, level } = newConfigValue;
        newRep.setWindowWidth(width);
        newRep.setWindowLevel(level);
        viewProxy.value.renderLater();
      }
    });

    return {
      vtkContainerRef,
      viewID,
      active: false,
      resetCamera,
    };
  },
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.vtk-three-container {
  background-color: black;
  grid-template-columns: auto;
}
</style>
