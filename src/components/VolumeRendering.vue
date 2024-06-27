<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  watch,
  watchEffect,
} from 'vue';
import { onKeyDown, onKeyUp } from '@vueuse/core';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import type { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import useViewAnimationStore from '@/src/store/view-animation';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { useResizeObserver } from '../composables/useResizeObserver';
import { useCurrentImage } from '../composables/useCurrentImage';
import useVolumeColoringStore from '../store/view-configs/volume-coloring';
import {
  getColorFunctionRangeFromPreset,
  getShiftedOpacityFromPreset,
} from '../utils/vtk-helpers';
import { useVolumeThumbnailing } from '../composables/useVolumeThumbnailing';
import { InitViewIDs } from '../config';

const WIDGET_WIDTH = 250;
const WIDGET_HEIGHT = 150;
const THUMBNAIL_SIZE = 80;
const TARGET_VIEW_ID = InitViewIDs.Three;

export default defineComponent({
  name: 'VolumeRendering',
  setup() {
    const volumeColoringStore = useVolumeColoringStore();
    const editorContainerRef = ref<HTMLElement | null>(null);
    const pwfEditorRef = ref<HTMLElement | null>(null);

    let recurseGuard = false;

    const { currentImageID, currentImageData } = useCurrentImage();

    const volumeColorConfig = computed(() =>
      volumeColoringStore.getConfig(TARGET_VIEW_ID, currentImageID.value)
    );

    watch(volumeColorConfig, () => {
      const imageID = currentImageID.value;
      if (imageID && !volumeColorConfig.value) {
        // creates a default color config
        volumeColoringStore.updateConfig(TARGET_VIEW_ID, imageID, {});
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
        volumeColoringStore.updateOpacityFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mode,
            gaussians: pwfWidget.getGaussians(),
          }
        );
      } else if (mode === vtkPiecewiseFunctionProxy.Mode.Points) {
        volumeColoringStore.updateOpacityFunction(
          TARGET_VIEW_ID,
          currentImageID.value,
          {
            mode,
            shift: pwfWidget.getOpacityPointShift(),
            shiftAlpha: pwfWidget.getOpacityValueShift(),
          }
        );
      }

      pwfWidget.render();

      recurseGuard = false;
    }

    onVTKEvent(pwfWidget, 'onOpacityChange', updateOpacityFunc);

    // trigger 3D view animations when updating the opacity widget
    const viewAnimationStore = useViewAnimationStore();
    let animationRequested = false;

    const request3DAnimation = () => {
      if (!animationRequested) {
        animationRequested = true;
        viewAnimationStore.requestAnimation(pwfWidget, {
          byViewType: ['3D'],
        });
      }
    };

    const cancel3DAnimation = () => {
      animationRequested = false;
      viewAnimationStore.cancelAnimation(pwfWidget);
    };

    onVTKEvent(pwfWidget, 'onAnimation', (animating: boolean) => {
      if (animating) {
        request3DAnimation();
      } else {
        cancel3DAnimation();
      }
    });

    // handles edge case where component unmounts while widget is animating
    onBeforeUnmount(() => {
      cancel3DAnimation();
    });

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
          pwfWidget.setDataArray(scalars);
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

    onVTKEvent(colorTransferFunc, 'onModified', () => pwfWidget.render());

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
            0,
            0
          );
          pwfWidget.setOpacityPoints(points, opFunc.shift, opFunc.shiftAlpha);
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

    const fullMappingRange = computed(
      () =>
        getColorFunctionRangeFromPreset(selectedPreset.value || '') ||
        imageDataRange.value
    );
    const fullMappingRangeWidth = computed(() => {
      const range = fullMappingRange.value;
      return range[1] - range[0];
    });

    const selectPreset = (name: string) => {
      if (!currentImageID.value) return;
      volumeColoringStore.setColorPreset(
        TARGET_VIEW_ID,
        currentImageID.value,
        name
      );
    };

    // --- mapping range editing --- //

    const rangeShift = ref(0);
    const rangeWidth = ref(0);

    onKeyDown('Control', () => pwfWidget.setShiftOpacityValues(true));
    onKeyUp('Control', () => pwfWidget.setShiftOpacityValues(false));

    const reset = () => {
      rangeShift.value = 0;
      rangeWidth.value = fullMappingRangeWidth.value;
    };
    // reset case
    watch([selectedPreset, currentImageID], reset, { immediate: true });

    useResetViewsEvents().onClick(reset);

    watch([rangeShift, rangeWidth], ([shift, width]) => {
      const imageID = currentImageID.value;
      if (!imageID) return;

      const fullRange = fullMappingRange.value;
      const fullWidth = fullMappingRangeWidth.value;
      const min = fullRange[0] + Math.floor((fullWidth - width) / 2) + shift;
      const max = fullRange[1] - Math.ceil((fullWidth - width) / 2) + shift;

      volumeColoringStore.updateColorTransferFunction(TARGET_VIEW_ID, imageID, {
        mappingRange: [min, max],
      });
    });

    return {
      editorContainerRef,
      pwfEditorRef,
      thumbnails: currentThumbnails,
      hasCurrentImage,
      preset: selectedPreset,
      fullMappingRange,
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
      rangeShiftMin: computed(() => -fullMappingRangeWidth.value / 2),
      rangeShiftMax: computed(() => fullMappingRangeWidth.value / 2),
      rangeShift,
      rangeWidth,
      rangeWidthMax: computed(() => fullMappingRangeWidth.value * 2),
      request3DAnimation,
      cancel3DAnimation,
      selectPreset,
    };
  },
});
</script>

<template>
  <div class="overflow-hidden">
    <div class="mt-4 pwf-editor" ref="editorContainerRef">
      <div ref="pwfEditorRef" />
    </div>
    <div class="mapping-range-editor">
      <v-slider
        v-model="rangeShift"
        density="compact"
        hide-details
        label="Shift"
        :min="rangeShiftMin"
        :max="rangeShiftMax"
        :step="colorSliderStep"
        @pointerdown="request3DAnimation"
        @pointerup="cancel3DAnimation"
      />
      <v-slider
        v-model="rangeWidth"
        density="compact"
        hide-details
        label="Width"
        min="1"
        :max="rangeWidthMax"
        :step="colorSliderStep"
        @pointerdown="request3DAnimation"
        @pointerup="cancel3DAnimation"
      />
    </div>
  </div>
</template>

<style scoped>
.pwf-editor {
  touch-action: none;
}

.mapping-range-editor {
  padding: 8px 16px 8px 4px;
}
</style>
