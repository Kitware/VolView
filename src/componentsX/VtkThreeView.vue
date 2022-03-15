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
              <span>{{ topLeftLabel }}</span>
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
import vtkVolumeRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';

import { useIDStore } from '@src/storex/id';
import {
  defaultImageMetadata,
  useImageStore,
} from '@src/storex/datasets-images';
import { useView3DStore } from '@src/storex/views-3D';
import { useVTKProxyStore } from '@src/storex/vtk-proxy';
import { useProxyManager } from '@/src/composables/proxyManager';
import vtkLPSView2DProxy from '@src/vtk/LPSView2DProxy';

import SliceSlider from '@src/components/SliceSlider.vue';
import ViewOverlayGrid from '@src/componentsX/ViewOverlayGrid.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { getLPSDirections, LPSAxisDir } from '../utils/lps';
import { useDatasetStore } from '../storex/datasets';

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
    const dataStore = useDatasetStore();
    const view3DStore = useView3DStore();
    const imageStore = useImageStore();
    const proxyStore = useVTKProxyStore();
    const proxyManager = useProxyManager()!;

    const { viewDirection, viewUp } = toRefs(props);

    const vtkContainerRef = ref<HTMLElement>();
    const currentRepRef = ref<vtkVolumeRepresentationProxy>();

    // --- view store --- //

    const viewID = idStore.getNextID();

    // --- computed vars --- //

    const curImageID = computed(() => {
      const { primarySelection } = dataStore;
      if (primarySelection?.type === 'image') {
        return primarySelection.dataID;
      }
      if (primarySelection?.type === 'dicom') {
        // TODO
      }
      return null;
    });
    const curImageMetadata = computed(() => {
      const { metadata } = imageStore;
      if (curImageID.value) {
        return metadata[curImageID.value];
      }
      return defaultImageMetadata();
    });
    const coloringConfig = computed(() => view3DStore.coloringConfig);
    const colorBy = computed(() => coloringConfig.value.colorBy);
    const colorTransferFuncName = computed(
      () => coloringConfig.value.transferFunction
    );

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
      const { dataToProxyID } = proxyStore;

      viewProxy.removeAllRepresentations();

      // update the current image
      if (curImageID.value && curImageID.value in dataToProxyID) {
        const proxyID = dataToProxyID[curImageID.value];
        const sourceProxy = proxyManager.getProxyById<
          vtkSourceProxy<vtkImageData>
        >(proxyID);
        if (sourceProxy) {
          const rep = proxyManager.getRepresentation<vtkVolumeRepresentationProxy>(
            sourceProxy,
            viewProxy
          );
          if (rep) {
            currentRepRef.value = rep;
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
      viewProxy.resetCamera();
      viewProxy.render();
    };

    watch(
      [curImageMetadata, cameraDirVec, cameraUpVec, lpsDirections],
      () => resetCamera(),
      { immediate: true }
    );

    // --- coloring --- //

    watchEffect(() => {
      const rep = currentRepRef.value;
      const { arrayName, location } = colorBy.value;

      // TODO move lut stuff to proxymanager sync code
      const lut = proxyManager.getLookupTable(arrayName);
      lut.setMode(vtkLookupTableProxy.Mode.Preset);
      lut.setPresetName(colorTransferFuncName.value);
      if (rep) {
        rep.setColorBy(arrayName, location);
      }
    });

    // --- template vars --- //

    return {
      vtkContainerRef,
      active: false,
      topLeftLabel: colorTransferFuncName,
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
