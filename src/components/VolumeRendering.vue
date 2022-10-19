<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  watch,
  watchEffect,
} from '@vue/composition-api';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import { useResizeObserver } from '../composables/useResizeObserver';
import { manageVTKSubscription } from '../composables/manageVTKSubscription';
import { useCurrentImage } from '../composables/useCurrentImage';
import ColorFunctionSlider from './ColorFunctionSlider.vue';
import { useVTKCallback } from '../composables/useVTKCallback';
import { useViewConfigStore } from '../store/view-configs';
import {
  getColorFunctionRangeFromPreset,
  getShiftedOpacityFromPreset,
} from '../utils/vtk-helpers';
import { useVolumeThumbnailing } from '../composables/useVolumeThumbnailing';

const WIDGET_WIDTH = 250;
const WIDGET_HEIGHT = 150;
const THUMBNAIL_SIZE = 80;
const TARGET_VIEW_ID = '3D';

export default defineComponent({
  name: 'VolumeRendering',
  components: {
    ColorFunctionSlider,
  },
  setup() {
    const viewConfigStore = useViewConfigStore();
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
    const opacityFunction = computed(
      () => volumeColorConfig.value?.opacityFunction
    );

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

    const colorTransferFunc = vtkColorTransferFunction.newInstance();
    pwfWidget.setColorTransferFunction(colorTransferFunc);

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
      (func) => {
        if (func) {
          const { preset: name, mappingRange } = func;
          const preset = vtkColorMaps.getPresetByName(name);
          colorTransferFunc.applyColorMap(preset);
          colorTransferFunc.setMappingRange(...mappingRange);
          // force modification when mapping range is the same
          colorTransferFunc.modified();
        }
      },
      { immediate: true }
    );

    const onTFModified = useVTKCallback(colorTransferFunc.onModified);
    onTFModified(() => pwfWidget.render());

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

    const { currentThumbnails } = useVolumeThumbnailing(THUMBNAIL_SIZE);

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
      viewConfigStore.setVolumeColorPreset(
        TARGET_VIEW_ID,
        currentImageID.value,
        name
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
  <div class="overflow-hidden">
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
  </div>
</template>
