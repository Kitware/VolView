<script setup lang="ts">
import { computed } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { useImageStatsStore } from '@/src/store/image-stats';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import '@/src/vtk/ColorMaps';
import ImageDisplayControls from './ImageDisplayControls.vue';
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
  <ImageDisplayControls
    :key="imageId"
    :image-name="imageName"
    :preset="preset"
    :mapping-range="mappingRange"
    :image-range="imageRange"
    :visibility="visibility"
    :unavailable-reason="unavailableReason"
    :visibility-unavailable-reason="visibilityUnavailableReason"
    :close-on-content-click="false"
    window-level
    test-id-prefix="base-image"
    data-testid="base-image-properties"
    @toggle-visibility="toggleVisibility"
    @update:preset="setPreset"
    @update:mapping-range="setRange"
  >
    <template #label>
      <span class="text-caption text-medium-emphasis text-no-wrap">
        Base image
      </span>
    </template>
    <template #contrast="{ resetRangeDrafts }">
      <WindowLevelControls
        v-if="sliceView"
        :view-id="sliceView.id"
        :image-id="imageId"
        @change="resetRangeDrafts"
      />
    </template>
  </ImageDisplayControls>
</template>
