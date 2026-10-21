<script setup lang="ts">
import { computed } from 'vue';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import '@/src/vtk/ColorMaps';
import { useImageCacheStore } from '@/src/store/image-cache';
import { NO_NAME } from '@/src/constants';
import type { Layer } from '@/src/store/datasets-layers';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { isValidDisplayRange } from '@/src/utils/isValidDisplayRange';
import ImageDisplayControls from './ImageDisplayControls.vue';
import LayerContrastPresets from './LayerContrastPresets.vue';

const props = defineProps<{ layer: Layer }>();
const imageCacheStore = useImageCacheStore();
const layerColoringStore = useLayerColoringStore();

const imageName = computed(
  () => imageCacheStore.getImageMetadata(props.layer.selection)?.name ?? NO_NAME
);

const image = computed(() => imageCacheStore.getVtkImageData(props.layer.id));

const componentCount = computed(
  () => image.value?.getPointData().getScalars()?.getNumberOfComponents() ?? 0
);

const unavailableReason = computed(() =>
  image.value ? '' : 'The overlay image must finish loading first.'
);

const coloringUnavailableReason = computed(() => {
  if (unavailableReason.value) return unavailableReason.value;
  if (componentCount.value !== 1)
    return 'Color map, range, contrast, and background transparency require a single-component overlay.';
  return '';
});

const config = computed(() => {
  if (!image.value) return undefined;
  return layerColoringStore.getDisplayConfig(props.layer.id);
});

const mappingRange = computed(() => config.value?.mappingRange);
const preset = computed(() => config.value?.preset ?? '');
const opacity = computed(() => config.value?.opacity ?? 0.3);
const visibility = computed(() => config.value?.visibility ?? true);

const transparentBackground = computed(
  () => config.value?.transparentBackground ?? true
);

function setPreset(value: string) {
  if (coloringUnavailableReason.value || !vtkColorMaps.getPresetByName(value))
    return;
  layerColoringStore.updateDisplayConfig(props.layer.id, { preset: value });
}

function toggleVisibility() {
  if (unavailableReason.value) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, {
    visibility: !visibility.value,
  });
}

function setOpacity(value: number) {
  if (unavailableReason.value) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, { opacity: value });
}

function setTransparentBackground(value: boolean | null) {
  if (coloringUnavailableReason.value || value === null) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, {
    transparentBackground: value,
  });
}

const imageRange = computed(() => {
  const range = image.value?.getPointData().getScalars().getRange() ?? [0, 1];
  return [range[0], range[1]] as const;
});

function setRange(range: [number, number]) {
  if (coloringUnavailableReason.value || !isValidDisplayRange(range)) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, {
    mappingRange: range,
  });
}
</script>

<template>
  <ImageDisplayControls
    :key="layer.id"
    :image-name="imageName"
    :preset="preset"
    :mapping-range="mappingRange ?? [0, 1]"
    :image-range="imageRange"
    :visibility="visibility"
    :unavailable-reason="coloringUnavailableReason"
    :visibility-unavailable-reason="unavailableReason"
    :transparent-background="transparentBackground"
    test-id-prefix="layer"
    @toggle-visibility="toggleVisibility"
    @update:preset="setPreset"
    @update:mapping-range="setRange"
  >
    <template #contrast="{ applyRange }">
      <LayerContrastPresets
        :image-id="layer.id"
        :image-name="imageName"
        :image-range="imageRange"
        :unavailable-reason="coloringUnavailableReason"
        @select="applyRange"
      />
    </template>
    <v-slider
      class="pt-2"
      label="Opacity"
      name="Opacity"
      min="0"
      max="1"
      step="0.01"
      density="compact"
      hide-details
      thumb-label
      :disabled="!!unavailableReason"
      :model-value="opacity"
      data-testid="layer-opacity-slider"
      @update:model-value="setOpacity"
    >
      <template #thumb-label="{ modelValue }">
        {{ Math.round(modelValue * 100) }}%
      </template>
    </v-slider>
    <v-tooltip
      :text="
        coloringUnavailableReason ||
        'Values at or below Min are transparent, with a gradual fade over the first 10% of the display range above Min.'
      "
    >
      <template #activator="{ props: switchProps }">
        <div
          v-bind="switchProps"
          :tabindex="coloringUnavailableReason ? 0 : undefined"
        >
          <v-switch
            class="ms-3"
            label="Transparent background"
            :aria-describedby="switchProps['aria-describedby']"
            @focus="switchProps.onFocus?.($event)"
            @blur="switchProps.onBlur?.($event)"
            :model-value="transparentBackground"
            :disabled="!!coloringUnavailableReason"
            density="compact"
            hide-details
            color="primary"
            data-testid="layer-transparent-background"
            @update:model-value="setTransparentBackground"
          />
        </div>
      </template>
    </v-tooltip>
  </ImageDisplayControls>
</template>
