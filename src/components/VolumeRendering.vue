<script lang="ts">
import {
  computed,
  defineComponent,
  del,
  onBeforeUnmount,
  reactive,
  ref,
  set,
  watch,
  watchEffect,
} from '@vue/composition-api';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector3 } from '@kitware/vtk.js/types';
import { useResizeObserver } from '../composables/useResizeObserver';
import { manageVTKSubscription } from '../composables/manageVTKSubscription';
import {
  useView3DStore,
  getOpacityFunctionFromPreset,
  getShiftedOpacityFromPreset,
} from '../store/views-3D';
import { useProxyManager } from '../composables/proxyManager';
import { useDatasetStore } from '../store/datasets';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import { LPSAxisDir } from '../utils/lps';
import { useImageStore } from '../store/datasets-images';

const WIDGET_WIDTH = 250;
const WIDGET_HEIGHT = 150;
const THUMBNAIL_SIZE = 80;

function resetOpacityFunction(
  pwfProxy: vtkPiecewiseFunctionProxy,
  dataRange: [number, number],
  presetName: string
) {
  // reset pwf proxy range
  pwfProxy.setDataRange(...dataRange);

  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    const OpacityPoints = preset.OpacityPoints as number[];
    const points = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      xmin = Math.min(xmin, OpacityPoints[i]);
      xmax = Math.max(xmax, OpacityPoints[i]);
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const width = xmax - xmin;
    const pointsNormalized = points.map(([x, y]) => [(x - xmin) / width, y]);

    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Points);
    pwfProxy.setPoints(pointsNormalized);
  } else {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Gaussians);
    pwfProxy.setGaussians(vtkPiecewiseFunctionProxy.Defaults.Gaussians);
  }
}

export default defineComponent({
  name: 'VolumeRendering',
  components: {
    ItemGroup,
    GroupableItem,
  },
  setup() {
    const view3DStore = useView3DStore();
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();
    const proxyManager = useProxyManager();
    const editorContainerRef = ref<HTMLElement | null>(null);
    const pwfEditorRef = ref<HTMLElement | null>(null);

    const { currentImageID } = useCurrentImage();
    const primaryDatasetRef = computed(() => dataStore.primaryDataset);
    const colorTransferFunctionRef = computed(
      () => view3DStore.coloringConfig.transferFunction
    );
    const colorByRef = computed(() => view3DStore.coloringConfig.colorBy);
    const opacityFunction = computed(
      () => view3DStore.coloringConfig.opacityFunction
    );

    // --- piecewise function and color transfer function --- //

    const pwfProxyRef = computed(() => {
      const { arrayName } = colorByRef.value;
      if (arrayName) {
        return proxyManager?.getPiecewiseFunction(arrayName);
      }
      return null;
    });
    const lutProxyRef = computed(() => {
      return pwfProxyRef.value?.getLookupTableProxy();
    });

    // --- piecewise color function editor --- //

    const pwfWidget = vtkPiecewiseWidget.newInstance({
      numberOfBins: 256,
      size: [WIDGET_WIDTH, WIDGET_HEIGHT],
    });
    pwfWidget.updateStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      histogramColor: 'rgba(100, 100, 100, 0.5)',
      strokeColor: 'rgb(0, 0, 0)',
      activeColor: 'rgb(255, 255, 255)',
      handleColor: 'rgb(50, 150, 50)',
      buttonDisableFillColor: 'rgba(255, 255, 255, 0.5)',
      buttonDisableStrokeColor: 'rgba(0, 0, 0, 0.5)',
      buttonStrokeColor: 'rgba(0, 0, 0, 1)',
      buttonFillColor: 'rgba(255, 255, 255, 1)',
      strokeWidth: 2,
      activeStrokeWidth: 3,
      buttonStrokeWidth: 1.5,
      handleWidth: 3,
      iconSize: 0,
      padding: 10,
    });

    const pwfSubscriptions: vtkSubscription[] = [];

    onBeforeUnmount(() => {
      while (pwfSubscriptions.length) {
        pwfSubscriptions.pop()!.unsubscribe();
      }
    });

    let recurseGuard = false;
    function updateOpacityFunc() {
      if (recurseGuard) {
        return;
      }
      recurseGuard = true;

      const { mode } = opacityFunction.value;
      if (mode === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
        view3DStore.setOpacityFunction({
          mode,
          gaussians: pwfWidget.getGaussians(),
        });
      } else if (mode === vtkPiecewiseFunctionProxy.Mode.Points) {
        view3DStore.setOpacityFunction({
          mode,
          name: opacityFunction.value.name,
          shift: pwfWidget.getOpacityPointShift(),
        });
      }

      pwfWidget.render();

      recurseGuard = false;
    }

    manageVTKSubscription(pwfWidget.onOpacityChange(updateOpacityFunc));

    useResizeObserver(editorContainerRef, (entry) => {
      const { width } = entry.contentRect;
      if (width > 0) {
        pwfWidget.setSize(width, WIDGET_HEIGHT);
      }
      pwfWidget.render();
    });

    // mounted the pwf widget container
    watchEffect(() => {
      if (pwfEditorRef.value) {
        pwfWidget.setContainer(pwfEditorRef.value);
        pwfWidget.bindMouseListeners();
      }
    });

    onBeforeUnmount(() => {
      pwfWidget.unbindMouseListeners();
      pwfWidget.setContainer(null);
    });

    // update pwf widget when lut changes
    watch(
      colorTransferFunctionRef,
      () => {
        const lutProxy = lutProxyRef.value;
        const image = primaryDatasetRef.value;
        if (!lutProxy || !image) {
          return;
        }

        lutProxy.setDataRange(...image.getPointData().getScalars().getRange());
        const lut = lutProxy.getLookupTable();
        pwfWidget.setColorTransferFunction(lut);

        const scalars = image.getPointData().getScalars();
        pwfWidget.setDataArray(scalars.getData());

        pwfWidget.render();
      },
      { immediate: true }
    );

    // update pwf widget when opacity function changes
    watch(
      opacityFunction,
      (opFunc) => {
        if (opFunc.mode === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
          pwfWidget.setGaussiansMode();
          pwfWidget.setGaussians(opFunc.gaussians);
        } else if (opFunc.mode === vtkPiecewiseFunctionProxy.Mode.Points) {
          pwfWidget.setPointsMode();
          // get non-shifted points for the widget
          const points = getShiftedOpacityFromPreset(opFunc.name, 0);
          pwfWidget.setOpacityPoints(points, opFunc.shift);
        }

        pwfWidget.render();
      },
      { immediate: true }
    );

    // -- thumbnailing -- //

    const thumbnails = reactive<Record<string, Record<string, string>>>({});
    const thumbnailer = createVolumeThumbnailer(THUMBNAIL_SIZE);
    const { currentImageMetadata } = useCurrentImage();

    // same as 3D view
    const viewDirection = ref<LPSAxisDir>('Inferior');
    const viewUp = ref<LPSAxisDir>('Anterior');
    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      currentImageMetadata
    );

    // used to interrupt a thumbnailing cycle if
    // doThumbnailing is called again
    let interruptSentinel = Symbol('interrupt');

    async function doThumbnailing(imageID: string, image: vtkImageData) {
      const localSentinel = Symbol('interrupt');
      interruptSentinel = localSentinel;

      thumbnailer.setInputImage(image);
      const dataRange = image.getPointData().getScalars().getRange();

      async function helper(presetName: string) {
        // bail if a new thumbnail process has started
        if (interruptSentinel !== localSentinel) {
          return;
        }

        // sanity check; did the current image change
        if (imageID !== currentImageID.value) {
          return;
        }

        if (!(imageID in thumbnails)) {
          set(thumbnails, imageID, {});
        }

        if (presetName in thumbnails[imageID]) {
          return;
        }

        resetOpacityFunction(
          thumbnailer.opacityFuncProxy,
          dataRange,
          presetName
        );

        thumbnailer.colorTransferFuncProxy.setDataRange(...dataRange);
        thumbnailer.colorTransferFuncProxy.setMode(
          vtkLookupTableProxy.Mode.Preset
        );
        thumbnailer.colorTransferFuncProxy.setPresetName(presetName);

        thumbnailer.resetCameraWithOrientation(
          cameraDirVec.value as Vector3,
          cameraUpVec.value as Vector3
        );

        const renWin = thumbnailer.scene.getRenderWindow();
        renWin.render();
        const imageURL = await renWin.captureImages()[0];
        if (imageURL) {
          set(thumbnails[imageID], presetName, imageURL);
        }
      }

      PresetNameList.reduce(
        (promise, presetName) => promise.then(() => helper(presetName)),
        Promise.resolve()
      );
    }

    const currentThumbnails = ref<Record<string, string>>({});

    // workaround for computed not properly working on deeply reactive objects
    // in vue 2.
    watch(
      thumbnails,
      () => {
        if (currentImageID.value) {
          currentThumbnails.value = thumbnails[currentImageID.value];
        }
      },
      { deep: true }
    );

    // force thumbnailing to stop
    onBeforeUnmount(() => {
      interruptSentinel = Symbol('unmount');
    });

    // trigger thumbnailing
    watch(
      currentImageID,
      (imageID) => {
        if (imageID) {
          doThumbnailing(imageID, primaryDatasetRef.value!);
        }
      },
      { immediate: true }
    );

    // delete thumbnails if an image is deleted
    imageStore.$onAction(({ name, args, after }) => {
      const [id] = args;
      if (name === 'deleteData' && id in thumbnails) {
        after(() => del(thumbnails, id));
      }
    });

    const hasPrimaryDataset = computed(() => !!primaryDatasetRef.value);

    const selectPreset = (name: string) => {
      view3DStore.setColorTransferFunction(name);
      const opFunc = getOpacityFunctionFromPreset(name);
      view3DStore.setOpacityFunction(opFunc);
    };

    return {
      editorContainerRef,
      pwfEditorRef,
      thumbnails: currentThumbnails,
      hasPrimaryDataset,
      colorTransferFunctionName: colorTransferFunctionRef,
      presetList: PresetNameList,
      selectPreset,
      size: THUMBNAIL_SIZE,
    };
  },
});
</script>

<template>
  <div class="overflow-y-auto mx-2 fill-height">
    <template v-if="hasPrimaryDataset">
      <div class="mt-4" ref="editorContainerRef">
        <div ref="pwfEditorRef" />
      </div>
      <item-group
        class="container"
        :value="colorTransferFunctionName"
        @change="selectPreset"
      >
        <v-row no-gutters justify="center">
          <groupable-item
            v-for="preset in presetList"
            :key="preset"
            v-slot="{ active, select }"
            :value="preset"
          >
            <v-col
              cols="4"
              :class="{
                'thumbnail-container': true,
                blue: active,
              }"
              @click="select"
            >
              <v-img :src="thumbnails[preset] || ''" contain aspect-ratio="1">
                <v-overlay
                  absolute
                  :value="true"
                  opacity="0.3"
                  class="thumbnail-overlay"
                >
                  {{ preset.replace(/-/g, ' ') }}
                </v-overlay>
              </v-img>
            </v-col>
          </groupable-item>
        </v-row>
      </item-group>
    </template>
    <template v-else>
      <div class="text-center pt-12 text-subtitle-1">No image selected</div>
    </template>
  </div>
</template>

<style scoped>
.thumbnail-container {
  cursor: pointer;
  padding: 6px !important;
}

.thumbnail-overlay {
  top: 70%;
  height: 30%;
  font-size: 0.75em;
  text-align: center;
}
</style>
