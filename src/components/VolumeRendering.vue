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
import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import type { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import useViewAnimationStore from '@/src/store/view-animation';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { useVolumeColoringConfig } from '@/src/composables/useVolumeColoringConfig';
import { useVtkComputed } from '@/src/core/vtk/useVtkComputed';
import { useResizeObserver } from '@/src/composables/useResizeObserver';
import { usePiecewiseHistogram } from '@/src/composables/usePiecewiseHistogram';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import useVolumeColoringStore, {
  getColorAndOpacityFromPreset,
} from '@/src/store/view-configs/volume-coloring';
import {
  getAdaptiveVolumePresetUnavailableReason,
  isAdaptiveVolumePreset,
} from '@/src/utils/adaptiveVolumePreset';
import { getShiftedOpacityFromPreset } from '@/src/utils/vtk-helpers';

const WIDGET_WIDTH = 250;
const WIDGET_HEIGHT = 150;

function getBinarySliderStep(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  // Binary steps keep zero exactly on the shift slider's grid.
  return 2 ** Math.floor(Math.log2(step));
}

function getSliderBounds(
  [minimum, maximum]: [number, number],
  step: number,
  anchor: number,
  positiveMinimum = false
): [number, number] {
  if (!Number.isFinite(step) || step <= 0) return [minimum, maximum];
  const align = (value: number, round: (value: number) => number) =>
    anchor + round((value - anchor) / step) * step;
  const lower = align(minimum, Math.floor);
  return [
    positiveMinimum && lower <= 0 ? align(minimum, Math.ceil) : lower,
    align(maximum, Math.ceil),
  ];
}

export default defineComponent({
  name: 'VolumeRendering',
  props: {
    viewId: {
      type: String,
      default: null,
    },
  },
  setup(props) {
    const volumeColoringStore = useVolumeColoringStore();
    const editorContainerRef = ref<HTMLElement | null>(null);
    const pwfEditorRef = ref<HTMLElement | null>(null);
    const viewId = computed(() => props.viewId);

    let recurseGuard = false;

    const { currentImageID, currentImageData, currentImage } =
      useCurrentImage();

    useVolumeColoringInitializer(viewId, currentImageID);

    const volumeColorConfig = useVolumeColoringConfig(viewId, currentImageID);

    const colorTransferFunctionRef = computed(
      () => volumeColorConfig.value?.transferFunction
    );
    const opacityFunction = computed(
      () => volumeColorConfig.value?.opacityFunction
    );
    const canEditColoring = computed(
      () => !!colorTransferFunctionRef.value?.preset && !!currentImageData.value
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
    const updateHistogram = usePiecewiseHistogram(pwfWidget);

    const pwfSubscriptions: vtkSubscription[] = [];

    onBeforeUnmount(() => {
      while (pwfSubscriptions.length) {
        pwfSubscriptions.pop()!.unsubscribe();
      }
    });

    function updateOpacityFunc() {
      if (recurseGuard || !currentImageID.value || !viewId.value) {
        return;
      }
      recurseGuard = true;

      const { mode } = opacityFunction.value ?? {};
      if (mode === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
        volumeColoringStore.updateOpacityFunction(
          viewId.value,
          currentImageID.value,
          {
            mode,
            gaussians: pwfWidget.getGaussians(),
          }
        );
      } else if (mode === vtkPiecewiseFunctionProxy.Mode.Points) {
        volumeColoringStore.updateOpacityFunction(
          viewId.value,
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
      if (!animationRequested && viewId.value) {
        animationRequested = true;
        viewAnimationStore.requestAnimation(pwfWidget, {
          byViewType: [viewId.value],
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
      pwfWidget.delete();
      colorTransferFunc.delete();
    });

    watch(
      [
        currentImageData,
        () => colorTransferFunctionRef.value?.preset,
        () => opacityFunction.value?.mappingRange,
      ],
      ([image, preset, range]) => {
        if (!image) return;
        updateHistogram(
          image,
          preset && range && isAdaptiveVolumePreset(preset) ? range : undefined
        );
      },
      { immediate: true }
    );

    // update pwf widget when lut changes
    watch(
      colorTransferFunctionRef,
      (func) => {
        if (func) {
          const { preset: name, mappingRange } = func;
          pwfWidget.setGaussianMinimumHeight(
            isAdaptiveVolumePreset(name) ? 1e-6 : 0.05
          );
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

    // --- selection and updates --- //

    const selectedPreset = computed(
      () => colorTransferFunctionRef.value?.preset || null
    );
    const hasCurrentImage = computed(() => !!currentImageData.value);
    const resetImageUnavailableReason = computed(() => {
      const image = currentImageData.value;
      if (!image) return 'Load a volume to reset contrast and opacity';
      if (!currentImage.value?.isLoaded())
        return 'Wait for the complete volume to load';
      if (isAdaptiveVolumePreset(selectedPreset.value ?? ''))
        return getAdaptiveVolumePresetUnavailableReason(image, true);
      return image.getPointData().getScalars().getRange().every(Number.isFinite)
        ? ''
        : 'Reset requires finite intensities';
    });
    const resetColoringUnavailableReason = computed(() => {
      if (
        !viewId.value ||
        !currentImageID.value ||
        !colorTransferFunctionRef.value?.preset
      )
        return 'Wait for volume rendering to initialize';
      if (resetImageUnavailableReason.value)
        return resetImageUnavailableReason.value;
      if (
        volumeColoringStore.isColorAndOpacityDefault(
          viewId.value,
          currentImageID.value
        )
      )
        return 'Color and opacity already match the preset defaults';
      return '';
    });
    const canResetColoring = computed(
      () => !!viewId.value && !resetColoringUnavailableReason.value
    );
    const resetColorAndOpacity = () => {
      if (canResetColoring.value && viewId.value && currentImageID.value) {
        volumeColoringStore.resetColorAndOpacity(
          viewId.value,
          currentImageID.value
        );
      }
    };

    // the data range, if any
    const imageDataRange = useVtkComputed(
      currentImageData,
      (): [number, number] => {
        const image = currentImageData.value;
        if (image) {
          return image.getPointData().getScalars().getRange();
        }
        return [0, 1];
      }
    );

    const fullMappingRange = useVtkComputed(currentImageData, () => {
      const preset = colorTransferFunctionRef.value?.preset ?? '';
      const image = currentImageData.value;
      return (
        (image &&
          getColorAndOpacityFromPreset(image, preset)?.transferFunction
            .mappingRange) ||
        imageDataRange.value
      );
    });

    const fullMappingRangeWidth = computed(() => {
      const range = fullMappingRange.value;
      return range[1] - range[0];
    });

    const selectPreset = (name: string) => {
      if (!viewId.value || !currentImageID.value) return;
      volumeColoringStore.setColorPreset(
        viewId.value,
        currentImageID.value,
        name
      );
    };

    // --- mapping range editing --- //

    onKeyDown('Control', () => pwfWidget.setShiftOpacityValues(true));
    onKeyUp('Control', () => pwfWidget.setShiftOpacityValues(false));

    const rangeShift = computed({
      get() {
        const range = colorTransferFunctionRef.value?.mappingRange;
        if (!range) return 0;
        const fullRange = fullMappingRange.value;
        return (range[0] + range[1]) / 2 - (fullRange[0] + fullRange[1]) / 2;
      },
      set(shift: number) {
        updateMappingRange(shift, rangeWidth.value);
      },
    });
    const rangeWidth = computed({
      get() {
        const range = colorTransferFunctionRef.value?.mappingRange;
        return range ? range[1] - range[0] : 0;
      },
      set(width: number) {
        updateMappingRange(rangeShift.value, width);
      },
    });

    const colorSliderStep = computed(() => {
      const [low, high] = imageDataRange.value;
      const width = isAdaptiveVolumePreset(selectedPreset.value || '')
        ? fullMappingRangeWidth.value
        : high - low;
      const step = Math.min(1, width / 256, fullMappingRangeWidth.value / 256);
      return getBinarySliderStep(step);
    });
    const rangeShiftBounds = computed(() =>
      getSliderBounds(
        [
          Math.min(-fullMappingRangeWidth.value / 2, rangeShift.value),
          Math.max(fullMappingRangeWidth.value / 2, rangeShift.value),
        ],
        colorSliderStep.value,
        0
      )
    );
    const widthSliderStep = computed(() =>
      getBinarySliderStep(
        Math.min(
          colorSliderStep.value,
          rangeWidth.value > 0 ? rangeWidth.value : colorSliderStep.value
        )
      )
    );
    const rangeWidthBounds = computed(() => {
      const fullWidth = fullMappingRangeWidth.value;
      const positiveWidth = rangeWidth.value > 0 ? rangeWidth.value : 1;
      const minimum =
        fullWidth > 0 ? Math.min(1, fullWidth / 256, positiveWidth) : 1;
      return getSliderBounds(
        [minimum, Math.max(fullWidth * 2, positiveWidth, minimum)],
        widthSliderStep.value,
        fullWidth,
        true
      );
    });

    const reset = () => {
      rangeShift.value = 0;
      rangeWidth.value = fullMappingRangeWidth.value;
    };

    useResetViewsEvents().onClick(reset);

    function updateMappingRange(shift: number, width: number) {
      if (!canEditColoring.value || !viewId.value || !currentImageID.value)
        return;

      const fullRange = fullMappingRange.value;
      const fullCenter = (fullRange[0] + fullRange[1]) / 2;
      const newCenter = fullCenter + shift;
      const halfWidth = width / 2;

      const min = newCenter - halfWidth;
      const max = newCenter + halfWidth;

      const current = colorTransferFunctionRef.value?.mappingRange;
      if (current && current[0] === min && current[1] === max) return;
      volumeColoringStore.updateColorTransferFunction(
        viewId.value,
        currentImageID.value,
        { mappingRange: [min, max] }
      );
    }

    return {
      editorContainerRef,
      pwfEditorRef,
      canEditColoring,
      canResetColoring,
      resetColoringUnavailableReason,
      resetColorAndOpacity,
      hasCurrentImage,
      preset: selectedPreset,
      fullMappingRange,
      mappingRange: computed(
        () => colorTransferFunctionRef.value!.mappingRange
      ),
      colorSliderStep,
      widthSliderStep,
      rangeShiftMin: computed(() => rangeShiftBounds.value[0]),
      rangeShiftMax: computed(() => rangeShiftBounds.value[1]),
      rangeShift,
      rangeWidth,
      rangeWidthMin: computed(() => rangeWidthBounds.value[0]),
      rangeWidthMax: computed(() => rangeWidthBounds.value[1]),
      request3DAnimation,
      cancel3DAnimation,
      selectPreset,
    };
  },
});
</script>

<template>
  <div class="overflow-hidden">
    <div
      class="mt-4 pwf-editor"
      ref="editorContainerRef"
      data-testid="volume-opacity-editor"
    >
      <div ref="pwfEditorRef" />
    </div>
    <div class="mapping-range-editor">
      <div>
        <v-slider
          v-model="rangeShift"
          data-testid="volume-color-shift"
          :disabled="!canEditColoring"
          :title="
            canEditColoring
              ? undefined
              : 'Wait for volume rendering to initialize'
          "
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
          data-testid="volume-color-width"
          :disabled="!canEditColoring"
          :title="
            canEditColoring
              ? undefined
              : 'Wait for volume rendering to initialize'
          "
          density="compact"
          hide-details
          label="Width"
          :min="rangeWidthMin"
          :max="rangeWidthMax"
          :step="widthSliderStep"
          @pointerdown="request3DAnimation"
          @pointerup="cancel3DAnimation"
        />
      </div>
      <v-tooltip
        :text="
          canResetColoring
            ? 'Restore the opacity curve, Shift, and Width for the selected preset while keeping its palette and lighting'
            : resetColoringUnavailableReason
        "
      >
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="d-inline-flex">
            <v-btn
              data-testid="volume-reset-color-opacity"
              aria-label="Reset color and opacity"
              icon="mdi-restore"
              size="small"
              density="compact"
              variant="text"
              :disabled="!canResetColoring"
              @click="resetColorAndOpacity"
            />
          </span>
        </template>
      </v-tooltip>
    </div>
  </div>
</template>

<style scoped>
.pwf-editor {
  touch-action: none;
}

.mapping-range-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  padding: 8px 16px 8px 4px;
}
</style>
