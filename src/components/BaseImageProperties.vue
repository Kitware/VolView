<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import '@/src/vtk/ColorMaps';
import DisplayRangeControl from './DisplayRangeControl.vue';
import ColorMapSelect from './ColorMapSelect.vue';
import { resolveBaseColorPreset } from '@/src/vtk/LayerColorPresets';
import WindowLevelControls from './tools/windowing/WindowLevelControls.vue';

const props = defineProps<{ imageId: string }>();
const { imageData, metadata } = useImage(computed(() => props.imageId));
const viewStore = useViewStore();
const windowingStore = useWindowingStore();
const statsStore = useImageStatsStore();
const imageName = computed(() => metadata.value.name ?? NO_NAME);
const scalars = computed(() => imageData.value?.getPointData().getScalars());
const matchingViews = computed(() =>
  viewStore.visibleViews.filter((view) => view.dataID === props.imageId)
);
const sliceView = computed(() => {
  const views = matchingViews.value.filter(
    ({ type }) =>
      isCineImage(props.imageId) || type === '2D' || type === 'Oblique'
  );
  return views.find(({ id }) => id === viewStore.activeView) ?? views[0];
});
const referenceView = computed(
  () =>
    sliceView.value ??
    matchingViews.value.find(({ id }) => id === viewStore.activeView) ??
    matchingViews.value[0]
);
const windowing = computed(() =>
  referenceView.value
    ? windowingStore.getConfig(referenceView.value.id, props.imageId)
    : undefined
);
const visibility = computed(() => windowing.value?.visibility ?? true);
const visibilityUnavailableReason = computed(() => {
  if (!imageData.value || !scalars.value)
    return 'The image must finish loading first.';
  if (!sliceView.value)
    return 'Open a 2D or oblique view showing this image to change visibility.';
  return '';
});
function toggleVisibility() {
  if (visibilityUnavailableReason.value || !sliceView.value) return;
  windowingStore.updateConfig(
    sliceView.value.id,
    props.imageId,
    { visibility: !visibility.value },
    true
  );
}
const preset = computed(() => resolveBaseColorPreset(windowing.value?.preset));
function setPreset(value: string) {
  if (unavailableReason.value || !sliceView.value) return;
  windowingStore.updateConfig(
    sliceView.value.id,
    props.imageId,
    {
      preset: resolveBaseColorPreset(value),
    },
    true
  );
}
const mappingRange = computed(() => {
  const width = windowing.value?.width ?? 1;
  const level = windowing.value?.level ?? 0.5;
  return [level - width / 2, level + width / 2] as const;
});
const imageRange = computed(() => {
  const stats = statsStore.stats[props.imageId];
  const range = scalars.value?.getRange() ?? [0, 1];
  return [stats?.scalarMin ?? range[0], stats?.scalarMax ?? range[1]] as const;
});
const histogram = computed(() =>
  !isCineImage(props.imageId) && scalars.value?.getNumberOfComponents() === 1
    ? statsStore.stats[props.imageId]?.histogram
    : undefined
);
const unavailableReason = computed(() => {
  if (!imageData.value || !scalars.value)
    return 'The image must finish loading first.';
  if (isCineImage(props.imageId))
    return 'Cine images already contain display-encoded pixels.';
  if (scalars.value.getNumberOfComponents() !== 1)
    return 'Window/level editing requires a single-component image.';
  if (!sliceView.value)
    return 'Open a 2D or oblique view showing this image to adjust window/level.';
  return '';
});
const rangeControl = ref<InstanceType<typeof DisplayRangeControl>>();
async function resetRangeDrafts() {
  await nextTick();
  rangeControl.value?.resetDrafts();
}
const contrastOpen = ref(false);
watch(unavailableReason, (reason) => {
  if (reason) contrastOpen.value = false;
});
function setRange([min, max]: [number, number]) {
  const view = sliceView.value;
  const width = max - min;
  const level = min + width / 2;
  if (
    unavailableReason.value ||
    !view ||
    ![min, max, width, level].every(Number.isFinite) ||
    width <= 0 ||
    ![level - width / 2, level + width / 2].every(Number.isFinite) ||
    level - width / 2 >= level + width / 2
  )
    return;
  windowingStore.updateConfig(view.id, props.imageId, { width, level }, true);
}
</script>

<template>
  <section :aria-label="imageName" data-testid="base-image-properties">
    <div class="d-flex align-center ga-3 mb-3">
      <v-tooltip :text="imageName" location="top">
        <template #activator="{ props: tooltipProps }">
          <h4 class="text-ellipsis" v-bind="tooltipProps">{{ imageName }}</h4>
        </template>
      </v-tooltip>
      <span class="text-caption text-medium-emphasis text-no-wrap"
        >Base image</span
      >
    </div>
    <div class="ms-4">
      <div class="d-flex align-center ga-2">
        <v-tooltip
          :text="visibilityUnavailableReason"
          :disabled="!visibilityUnavailableReason"
        >
          <template #activator="{ props: tooltipProps }">
            <span
              v-bind="tooltipProps"
              :tabindex="visibilityUnavailableReason ? 0 : undefined"
            >
              <v-btn
                size="small"
                height="40"
                width="88"
                :prepend-icon="visibility ? 'mdi-eye' : 'mdi-eye-off'"
                :aria-label="`${visibility ? 'Hide' : 'Show'} ${imageName}`"
                :disabled="!!visibilityUnavailableReason"
                data-testid="base-image-visibility"
                @click="toggleVisibility"
              >
                {{ visibility ? 'Hide' : 'Show' }}
              </v-btn>
            </span>
          </template>
        </v-tooltip>
        <v-tooltip :text="unavailableReason" :disabled="!unavailableReason">
          <template #activator="{ props: tooltipProps }">
            <div
              class="base-colormap"
              v-bind="tooltipProps"
              :tabindex="unavailableReason ? 0 : undefined"
            >
              <ColorMapSelect
                :model-value="preset"
                :disabled="!!unavailableReason"
                test-id-prefix="base-image"
                @update:model-value="setPreset"
              />
            </div>
          </template>
        </v-tooltip>
      </div>
      <v-tooltip :text="unavailableReason" :disabled="!unavailableReason">
        <template #activator="{ props: tooltipProps }">
          <div
            v-bind="tooltipProps"
            :tabindex="unavailableReason ? 0 : undefined"
          >
            <DisplayRangeControl
              ref="rangeControl"
              class="mt-1"
              :key="imageId"
              :model-value="mappingRange"
              :data-range="imageRange"
              :histogram="histogram"
              :preset="preset"
              :disabled="!!unavailableReason"
              window-level
              test-id-prefix="base-image-range"
              @update:model-value="setRange"
            >
              <template #actions>
                <v-menu
                  v-model="contrastOpen"
                  :close-on-content-click="false"
                  :disabled="!!unavailableReason"
                  location="bottom"
                >
                  <template #activator="{ props: menuProps }">
                    <v-btn
                      v-bind="menuProps"
                      size="small"
                      height="40"
                      prepend-icon="mdi-circle-half-full"
                      append-icon="mdi-menu-down"
                      :disabled="!!unavailableReason"
                      data-testid="base-image-contrast"
                    >
                      Contrast
                    </v-btn>
                  </template>
                  <WindowLevelControls
                    v-if="sliceView"
                    :view-id="sliceView.id"
                    :image-id="imageId"
                    @change="resetRangeDrafts"
                  />
                </v-menu>
              </template>
            </DisplayRangeControl>
          </div>
        </template>
      </v-tooltip>
    </div>
  </section>
</template>

<style scoped>
.base-colormap {
  flex: 1;
  min-width: 0;
}
</style>
