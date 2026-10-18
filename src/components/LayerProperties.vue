<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import '@/src/vtk/ColorMaps';
import { useImageCacheStore } from '@/src/store/image-cache';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME, WLAutoRanges } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { Layer, useLayersStore } from '@/src/store/datasets-layers';
import useLayerColoringStore from '@/src/store/view-configs/layers';
import { useViewStore } from '@/src/store/views';
import ColorMapSelect from './ColorMapSelect.vue';
import DisplayRangeControl from './DisplayRangeControl.vue';

const props = defineProps<{ layer: Layer }>();
const imageCacheStore = useImageCacheStore();
const viewStore = useViewStore();
const layersStore = useLayersStore();
const layerColoringStore = useLayerColoringStore();
const imageStatsStore = useImageStatsStore();
const imageName = computed(
  () => imageCacheStore.getImageMetadata(props.layer.selection)?.name ?? NO_NAME
);
const image = computed(() => imageCacheStore.getVtkImageData(props.layer.id));
const referenceView = computed(() => {
  const visibleViews = viewStore.visibleViews.filter(
    (view) =>
      view.type === '2D' &&
      layersStore.getLayers(view.dataID).some(({ id }) => id === props.layer.id)
  );
  return (
    visibleViews.find(({ id }) => id === viewStore.activeView) ??
    visibleViews[0]
  );
});
const unavailableReason = computed(() => {
  if (!image.value) return 'The overlay image must finish loading first.';
  if (!referenceView.value)
    return 'Open a 2D view showing this overlay to adjust it.';
  return '';
});
const coloringUnavailableReason = computed(() => {
  if (unavailableReason.value) return unavailableReason.value;
  if (image.value?.getPointData().getScalars()?.getNumberOfComponents() !== 1)
    return 'Color map, range, and contrast require a single-component overlay.';
  return '';
});
const transparencyUnavailableReason = computed(() => {
  if (unavailableReason.value) return unavailableReason.value;
  if (image.value?.getPointData().getScalars().getNumberOfComponents() !== 1)
    return 'Transparent background requires a single-component image.';
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
  if (transparencyUnavailableReason.value || value === null) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, {
    transparentBackground: value,
  });
}

const imageRange = computed(() => {
  const range = image.value?.getPointData().getScalars().getRange() ?? [0, 1];
  return [range[0], range[1]] as const;
});
const histogram = computed(() =>
  !isCineImage(props.layer.selection) &&
  image.value?.getPointData().getScalars()?.getNumberOfComponents() === 1
    ? imageStatsStore.stats[props.layer.id]?.histogram
    : undefined
);
const validRange = (
  range: readonly [number, number] | undefined
): range is readonly [number, number] =>
  !!range &&
  range.every(Number.isFinite) &&
  range[0] < range[1] &&
  Number.isFinite(range[1] - range[0]);
const contrastOpen = ref(false);
const rangeControl = ref<InstanceType<typeof DisplayRangeControl>>();
watch(coloringUnavailableReason, (reason) => {
  if (reason) contrastOpen.value = false;
});
const contrastOptions = computed(() => {
  const autoRanges = imageStatsStore.getAutoRangeValues(props.layer.id);
  return Object.keys(WLAutoRanges).map((key) => {
    const range = key === 'FullRange' ? imageRange.value : autoRanges[key];
    const unavailable =
      coloringUnavailableReason.value ||
      (!validRange(imageRange.value)
        ? 'Contrast requires a finite, nonconstant image range.'
        : !range
          ? 'Image statistics are still being computed.'
          : !validRange(range)
            ? 'This contrast setting does not have a finite, nonconstant range.'
            : '');
    return {
      key,
      label: key.replace(/([A-Z])/g, ' $1').trim(),
      range,
      unavailable,
    };
  });
});
async function setContrast(key: string) {
  const option = contrastOptions.value.find(
    (candidate) => candidate.key === key
  );
  if (!option || option.unavailable || !validRange(option.range)) return;
  setRange([option.range[0], option.range[1]]);
  contrastOpen.value = false;
  await nextTick();
  rangeControl.value?.resetDrafts();
}
function setRange(range: [number, number]) {
  if (coloringUnavailableReason.value || !validRange(range)) return;
  layerColoringStore.updateDisplayConfig(props.layer.id, {
    mappingRange: range,
  });
}
</script>

<template>
  <section :aria-label="imageName">
    <v-tooltip :text="imageName" location="top">
      <template #activator="{ props: tooltipProps }">
        <h4 class="text-ellipsis mb-3" v-bind="tooltipProps">
          {{ imageName }}
        </h4>
      </template>
    </v-tooltip>
    <v-tooltip
      :text="coloringUnavailableReason"
      :disabled="!coloringUnavailableReason"
    >
      <template #activator="{ props: tooltipProps }">
        <div
          class="ms-4"
          v-bind="tooltipProps"
          :tabindex="coloringUnavailableReason ? 0 : undefined"
        >
          <div class="d-flex align-center ga-2">
            <v-btn
              class="layer-visibility"
              size="small"
              height="40"
              width="88"
              :prepend-icon="visibility ? 'mdi-eye' : 'mdi-eye-off'"
              :aria-label="`${visibility ? 'Hide' : 'Show'} ${imageName}`"
              :disabled="!!unavailableReason"
              data-testid="layer-visibility"
              @click="toggleVisibility"
            >
              {{ visibility ? 'Hide' : 'Show' }}
            </v-btn>
            <ColorMapSelect
              class="layer-colormap"
              :model-value="preset"
              :disabled="!!coloringUnavailableReason"
              @update:model-value="setPreset"
            />
          </div>
          <DisplayRangeControl
            ref="rangeControl"
            :key="layer.id"
            class="mt-1"
            :model-value="mappingRange ?? [0, 1]"
            :data-range="imageRange"
            :histogram="histogram"
            :preset="preset"
            :transparent-background="transparentBackground"
            :disabled="!!coloringUnavailableReason"
            @update:model-value="setRange"
          >
            <template #actions>
              <v-menu
                v-model="contrastOpen"
                :disabled="!!coloringUnavailableReason"
                location="bottom"
              >
                <template #activator="{ props: menuProps }">
                  <v-btn
                    v-bind="menuProps"
                    size="small"
                    height="40"
                    prepend-icon="mdi-circle-half-full"
                    append-icon="mdi-menu-down"
                    :disabled="!!coloringUnavailableReason"
                    data-testid="layer-contrast"
                  >
                    Contrast
                  </v-btn>
                </template>
                <v-list
                  density="compact"
                  :aria-label="`${imageName} contrast`"
                  data-testid="layer-contrast-menu"
                >
                  <v-tooltip
                    v-for="option in contrastOptions"
                    :key="option.key"
                    :text="option.unavailable"
                    :disabled="!option.unavailable"
                  >
                    <template #activator="{ props: optionProps }">
                      <div
                        v-bind="optionProps"
                        :tabindex="option.unavailable ? 0 : undefined"
                      >
                        <v-list-item
                          :title="option.label"
                          :disabled="!!option.unavailable"
                          :data-testid="`layer-contrast-${option.key}`"
                          @click="setContrast(option.key)"
                        />
                      </div>
                    </template>
                  </v-tooltip>
                </v-list>
              </v-menu>
            </template>
          </DisplayRangeControl>
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
              transparencyUnavailableReason ||
              'Values at or below Min are transparent, with a gradual fade over the first 10% of the display range above Min.'
            "
          >
            <template #activator="{ props: switchProps }">
              <div
                v-bind="switchProps"
                :tabindex="transparencyUnavailableReason ? 0 : undefined"
              >
                <v-switch
                  class="ms-3"
                  label="Transparent background"
                  :aria-describedby="switchProps['aria-describedby']"
                  @focus="switchProps.onFocus?.($event)"
                  @blur="switchProps.onBlur?.($event)"
                  :model-value="transparentBackground"
                  :disabled="!!transparencyUnavailableReason"
                  density="compact"
                  hide-details
                  color="primary"
                  data-testid="layer-transparent-background"
                  @update:model-value="setTransparentBackground"
                />
              </div>
            </template>
          </v-tooltip>
        </div>
      </template>
    </v-tooltip>
  </section>
</template>

<style scoped>
.layer-colormap {
  flex: 1;
  min-width: 0;
}
.layer-visibility {
  flex-shrink: 0;
}
</style>
