<template>
  <div class="vtk-container-wrapper">
    <div class="vtk-gutter"></div>
    <div class="vtk-container" :class="active ? 'active' : ''">
      <div class="vtk-sub-container">
        <div class="vtk-view" ref="vtkContainerRef" />
      </div>
      <div class="overlay">
        <view-overlay-grid>
          <template v-slot:top-left>
            <div class="overlay-cell">
              <span>Hi</span>
            </div>
          </template>
        </view-overlay-grid>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
  watchEffect,
} from '@vue/composition-api';
import { mat3, vec3 } from 'gl-matrix';

import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import { useIDStore } from '@src/storex/id';
import {
  defaultImageMetadata,
  useImageStore,
} from '@src/storex/datasets-images';
import { useView3DStore } from '@src/storex/views-3D';
import { useViewStore } from '@src/storex/views';
import { useVTKProxyStore } from '@src/storex/vtk-proxy';
import { useProxyManager } from '@/src/composables/proxyManager';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';
import vtkIJKSliceRepresentationProxy from '@src/vtk/IJKSliceRepresentationProxy';

import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/componentsX/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSDirections, LPSAxisDir } from '../utils/lps';

export default defineComponent({
  props: {
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
    SliceSlider,
    ViewOverlayGrid,
  },
  setup(props) {
    const idStore = useIDStore();
    const viewStore = useViewStore();
    const view3DStore = useView3DStore();
    const imageStore = useImageStore();
    const proxyStore = useVTKProxyStore();
    const proxyManager = useProxyManager()!;

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();
    const currentImageRepRef = ref<vtkIJKSliceRepresentationProxy>();

    // --- view store --- //

    const viewID = idStore.getNextID();

    view3DStore.addView(viewID);
    onBeforeUnmount(() => {
      view3DStore.removeView(viewID);
    });

    // --- computed vars --- //

    const curImageMetadata = computed(() => {
      const { metadata } = imageStore;
      if (viewStore.currentImageID) {
        return metadata[viewStore.currentImageID];
      }
      return defaultImageMetadata();
    });
    const coloringConfig = computed(() => view3DStore.coloringConfigs[viewID]);
    const colorBy = computed(() => coloringConfig.value.colorBy);
    const colorTransferFuncName = computed(
      () => coloringConfig.value.transferFunction
    );

    watchEffect(() => {
      console.log('colorBy', colorBy.value);
      console.log('colorTF', colorTransferFuncName.value);
    });

    // --- view proxy setup --- //

    const viewProxy = proxyManager.createProxy<vtkLPSView2DProxy>(
      'Views',
      'View3D',
      {
        name: `View3D_${viewID}`,
      }
    );

    onMounted(() => {
      viewProxy.setOrientationAxesVisibility(true);
      viewProxy.setOrientationAxesType('cube');
      viewProxy.setBackground([0.1, 0.2, 0.3]);
      viewProxy.setContainer(vtkContainerRef.value ?? null);
    });

    onBeforeUnmount(() => {
      viewProxy.setContainer(null);
      proxyManager.deleteProxy(viewProxy);
    });

    useResizeObserver(vtkContainerRef, () => viewProxy.resize());

    // --- scene setup --- //

    watchEffect(() => {
      const curImageID = viewStore.currentImageID;
      const { dataToProxyID } = proxyStore;

      viewProxy.removeAllRepresentations();

      // update the current image
      if (curImageID && curImageID in dataToProxyID) {
        const proxyID = dataToProxyID[curImageID];
        const sourceProxy = proxyManager.getProxyById<
          vtkSourceProxy<vtkImageData>
        >(proxyID);
        if (sourceProxy) {
          const rep = proxyManager.getRepresentation<vtkIJKSliceRepresentationProxy>(
            sourceProxy,
            viewProxy
          );
          if (rep) {
            currentImageRepRef.value = rep;
            viewProxy.addRepresentation(rep);
          }
        }
      }

      // TODO not sure why I need this, but might as well keep
      // the renderer up to date.
      // For reference, this doesn't get invoked when resetting the
      // camera with a supplied bounds, so we manually invoke it here.
      viewProxy.getRenderer().computeVisiblePropBounds();
    });

    // --- camera setup --- //

    const orientationMatrix = computed(
      () => curImageMetadata.value.orientation as mat3
    );
    const lpsDirections = computed(() =>
      getLPSDirections(orientationMatrix.value)
    );
    const cameraDirVec = computed(
      () => lpsDirections.value[viewDirection.value]
    );
    const cameraUpVec = computed(() => lpsDirections.value[viewUp.value]);

    const resetCamera = () => {
      const bounds = curImageMetadata.value.worldBounds;
      const center = [
        (bounds[0] + bounds[1]) / 2,
        (bounds[2] + bounds[3]) / 2,
        (bounds[4] + bounds[5]) / 2,
      ] as vec3;

      viewProxy.updateCamera(cameraDirVec.value, cameraUpVec.value, center);
      viewProxy.resetCamera(bounds);

      viewProxy.render();
    };

    watch(
      [curImageMetadata, cameraDirVec, cameraUpVec, lpsDirections],
      () => resetCamera(),
      { immediate: true }
    );

    // --- template vars --- //

    return {
      vtkContainerRef,
      active: false,
    };
  },
});
</script>

<style src="@/src/assets/styles/vtk-view.css"></style>

<style scoped>
.vtk-gutter {
  display: flex;
  flex-flow: column;
}

.slice-slider {
  position: relative;
  flex: 1 1;
  width: 20px;
}

.overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  color: white;
  /* simulate text border */
  /* prettier-ignore */
  text-shadow:  1px  1px black,
                1px -1px black,
               -1px -1px black,
               -1px  1px black,
                0px  1px black,
                0px -1px black,
                1px  0px black,
               -1px  0px black;
  /* increase kerning to compensate for border */
  letter-spacing: 1px;
  font-size: clamp(8px, 0.75vw, 16px);
  /* handle text overflow */
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay-cell {
  padding: 4px;
  white-space: nowrap;
}
</style>
