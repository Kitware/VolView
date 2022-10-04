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
import { computedWithControl } from '@vueuse/shared';
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
import { useProxyManager } from '../composables/proxyManager';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import { useImageStore } from '../store/datasets-images';
import ColorFunctionSlider from './ColorFunctionSlider.vue';
import { useVTKCallback } from '../composables/useVTKCallback';
import { InitViewIDs, InitViewSpecs } from '../config';
import { useViewConfigStore } from '../store/view-configs';
import {
  getColorFunctionRangeFromPreset,
  getOpacityFunctionFromPreset,
  getOpacityRangeFromPreset,
  getShiftedOpacityFromPreset,
} from '../utils/vtk-helpers';
import { ColorTransferFunction } from '../types/views';

const WIDGET_WIDTH = 250;
const WIDGET_HEIGHT = 150;
const THUMBNAIL_SIZE = 80;
const TARGET_VIEW_ID = '3D';

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
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const [xmin, xmax] = dataRange;
    const width = xmax - xmin;
    const pointsNormalized = points.map(([x, y]) => [(x - xmin) / width, y]);

    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Points);
    pwfProxy.setPoints(pointsNormalized);
  } else {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Gaussians);
    pwfProxy.setGaussians(vtkPiecewiseFunctionProxy.Defaults.Gaussians);
  }
}

function useThumbnailing() {
  const thumbnails = reactive<Record<string, Record<string, string>>>({});
  const thumbnailer = createVolumeThumbnailer(THUMBNAIL_SIZE);
  const currentThumbnails = ref<Record<string, string>>({});

  const { currentImageMetadata, currentImageID, currentImageData } =
    useCurrentImage();

  // same as 3D view
  const { cameraDirVec, cameraUpVec } = useCameraOrientation(
    InitViewSpecs[InitViewIDs.Three].props.viewDirection,
    InitViewSpecs[InitViewIDs.Three].props.viewUp,
    currentImageMetadata
  );

  // used to interrupt a thumbnailing cycle if
  // doThumbnailing is called again
  let interruptSentinel = Symbol('interrupt');

  async function doThumbnailing(imageID: string, image: vtkImageData) {
    const localSentinel = Symbol('interrupt');
    interruptSentinel = localSentinel;

    thumbnailer.setInputImage(image);
    const imageDataRange = image.getPointData().getScalars().getRange();

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

      const opRange = getOpacityRangeFromPreset(presetName);
      resetOpacityFunction(
        thumbnailer.opacityFuncProxy,
        opRange || imageDataRange,
        presetName
      );

      thumbnailer.colorTransferFuncProxy.setMode(
        vtkLookupTableProxy.Mode.Preset
      );
      thumbnailer.colorTransferFuncProxy.setPresetName(presetName);
      const ctRange = getColorFunctionRangeFromPreset(presetName);
      thumbnailer.colorTransferFuncProxy.setDataRange(
        ...(ctRange || imageDataRange)
      );

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
        doThumbnailing(imageID, currentImageData.value!);
      }
    },
    { immediate: true }
  );

  // delete thumbnails if an image is deleted
  const imageStore = useImageStore();
  imageStore.$onAction(({ name, args, after }) => {
    if (name === 'deleteData') {
      const [id] = args as [string];
      if (id in thumbnails) {
        after(() => del(thumbnails, id));
      }
    }
  });

  return { currentThumbnails };
}

export default defineComponent({
  name: 'VolumeRendering',
  components: {
    ItemGroup,
    GroupableItem,
    ColorFunctionSlider,
  },
  setup() {
    const viewConfigStore = useViewConfigStore();
    const proxyManager = useProxyManager();
    const editorContainerRef = ref<HTMLElement | null>(null);
    const pwfEditorRef = ref<HTMLElement | null>(null);

    let recurseGuard = false;

    const { currentImageID, currentImageData } = useCurrentImage();

    const volumeColorConfig = viewConfigStore.getComputedVolumeColorConfig(
      TARGET_VIEW_ID,
      currentImageID
    );

    watch(volumeColorConfig, () => {
      const imageID = currentImageID.value;
      if (imageID && !volumeColorConfig.value) {
        // creates a default color config
        viewConfigStore.updateVolumeColorConfig(TARGET_VIEW_ID, imageID, {});
      }
    });

    const colorTransferFunctionRef = computed(
      () => volumeColorConfig.value?.transferFunction
    );
    const colorByRef = computed(() => volumeColorConfig.value?.colorBy);
    const opacityFunction = computed(
      () => volumeColorConfig.value?.opacityFunction
    );

    // --- piecewise function and color transfer function --- //

    const getColorByArray = () => colorByRef.value?.arrayName ?? null;

    const pwfProxyRef = computedWithControl(getColorByArray, () => {
      const arrayName = getColorByArray();
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

    function updateOpacityFunc() {
      if (recurseGuard || !currentImageID.value) {
        return;
      }
      recurseGuard = true;

      const { mode } = opacityFunction.value ?? {};
      if (mode === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
        viewConfigStore.updateVolumeOpacityFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mode,
            gaussians: pwfWidget.getGaussians(),
          }
        );
      } else if (mode === vtkPiecewiseFunctionProxy.Mode.Points) {
        viewConfigStore.updateVolumeOpacityFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mode,
            shift: pwfWidget.getOpacityPointShift(),
          }
        );
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

    watch(
      currentImageData,
      (image) => {
        if (image) {
          const scalars = image.getPointData().getScalars();
          pwfWidget.setDataArray(scalars.getData());
          pwfWidget.render();
        }
      },
      { immediate: true }
    );

    // update pwf widget when lut changes
    watch(
      colorTransferFunctionRef,
      () => {
        const lutProxy = lutProxyRef.value;
        if (lutProxy) {
          const lut = lutProxy.getLookupTable();
          pwfWidget.setColorTransferFunction(lut);
        }
      },
      { immediate: true }
    );

    const onLUTModified = useVTKCallback(
      computed(() => lutProxyRef.value?.getLookupTable().onModified)
    );

    onLUTModified(() => {
      pwfWidget.render();
    });

    // update pwf widget when opacity function changes
    watch(
      opacityFunction,
      (opFunc) => {
        if (!opFunc) return;

        if (opFunc.mode === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
          pwfWidget.setGaussiansMode();
          pwfWidget.setGaussians(opFunc.gaussians);
        } else if (opFunc.mode === vtkPiecewiseFunctionProxy.Mode.Points) {
          pwfWidget.setPointsMode();
          // get non-shifted points for the widget
          const points = getShiftedOpacityFromPreset(
            opFunc.preset,
            opFunc.mappingRange,
            0
          );
          pwfWidget.setOpacityPoints(points, opFunc.shift);
        }
      },
      { immediate: true }
    );

    // -- thumbnailing -- //

    const { currentThumbnails } = useThumbnailing();

    // --- selection and updates --- //

    const selectedPreset = computed(
      () => colorTransferFunctionRef.value?.preset || null
    );
    const hasCurrentImage = computed(() => !!currentImageData.value);

    // the data range, if any
    const imageDataRange = computed((): [number, number] => {
      const image = currentImageData.value;
      if (image) {
        return image.getPointData().getScalars().getRange();
      }
      return [0, 1];
    });
    const effectiveMappingRange = computed(
      () =>
        getColorFunctionRangeFromPreset(selectedPreset.value || '') ||
        imageDataRange.value
    );

    const selectPreset = (name: string) => {
      if (!currentImageID.value) return;

      const ctRange = getColorFunctionRangeFromPreset(name);
      const ctFunc: Partial<ColorTransferFunction> = {
        preset: name,
        mappingRange: ctRange || imageDataRange.value,
      };
      viewConfigStore.updateVolumeColorTransferFunction(
        TARGET_VIEW_ID,
        currentImageID.value,
        ctFunc
      );

      const opFunc = getOpacityFunctionFromPreset(name);
      const opRange = getOpacityRangeFromPreset(name);
      opFunc.mappingRange = opRange || imageDataRange.value;
      viewConfigStore.updateVolumeOpacityFunction(
        TARGET_VIEW_ID,
        currentImageID.value,
        opFunc
      );
    };

    const rgbPoints = computed(
      () =>
        vtkColorMaps.getPresetByName(colorTransferFunctionRef.value!.preset)
          ?.RGBPoints
    );

    const updateColorMappingRange = (range: [number, number]) => {
      const { mappingRange } = colorTransferFunctionRef.value ?? {};
      // guard against infinite loops
      if (
        currentImageID.value &&
        mappingRange &&
        (Math.abs(range[0] - mappingRange[0]) > 1e-6 ||
          Math.abs(range[1] - mappingRange[1]) > 1e-6)
      ) {
        viewConfigStore.updateVolumeColorTransferFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mappingRange: range,
          }
        );
      }
    };

    return {
      editorContainerRef,
      pwfEditorRef,
      thumbnails: currentThumbnails,
      hasCurrentImage,
      preset: selectedPreset,
      fullMappingRange: effectiveMappingRange,
      mappingRange: computed(
        () => colorTransferFunctionRef.value!.mappingRange
      ),
      colorSliderStep: computed(() => {
        const [low, high] = imageDataRange.value;
        const width = high - low;
        const step = Math.min(1, width / 256);
        return step > 1 ? Math.round(step) : step;
      }),
      presetList: PresetNameList,
      size: THUMBNAIL_SIZE,
      rgbPoints,
      selectPreset,
      updateColorMappingRange,
    };
  },
});
</script>

<template>
  <div class="overflow-x-hidden mx-2">
    <div class="mt-4" ref="editorContainerRef">
      <div ref="pwfEditorRef" />
    </div>
    <color-function-slider
      dense
      hide-details
      :min="fullMappingRange[0]"
      :max="fullMappingRange[1]"
      :step="colorSliderStep"
      :rgb-points="rgbPoints"
      :value="mappingRange"
      @input="updateColorMappingRange"
    />
    <item-group class="container" :value="preset" @change="selectPreset">
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
