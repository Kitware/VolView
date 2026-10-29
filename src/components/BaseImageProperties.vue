<script setup lang="ts">
import { computed, ref } from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { NO_NAME } from '@/src/constants';
import { getEnFaceUnavailableReason } from '@/src/enface/availability';
import { useViewStore } from '@/src/store/views';
import {
  sharesSourceWindowing,
  useWindowingStore,
} from '@/src/store/view-configs/windowing';
import '@/src/vtk/ColorMaps';
import ImageDisplayControls from './ImageDisplayControls.vue';
import { resolveBaseColorPreset } from '@/src/vtk/LayerColorPresets';
import WindowLevelControls from './tools/windowing/WindowLevelControls.vue';

const props = defineProps<{ imageId: string }>();
const displayControls = ref<InstanceType<typeof ImageDisplayControls>>();
const { imageData, metadata } = useImage(computed(() => props.imageId));
const viewStore = useViewStore();
const windowingStore = useWindowingStore();
const imageName = computed(() => metadata.value.name ?? NO_NAME);
const scalars = computed(() => imageData.value?.getPointData().getScalars());

const matchingViews = computed(() =>
  viewStore.visibleViews.filter((view) => view.dataID === props.imageId)
);

const displayView = computed(() => {
  const views = matchingViews.value.filter(
    ({ type }) =>
      isCineImage(props.imageId) ||
      type === '2D' ||
      type === 'Oblique' ||
      type === 'EnFace'
  );
  const active = views.find(({ id }) => id === viewStore.activeView);
  return (
    (active?.type === 'EnFace' && getEnFaceUnavailableReason(props.imageId)
      ? undefined
      : active) ??
    views.find(sharesSourceWindowing) ??
    views[0]
  );
});

windowingStore.ContrastResetEvent.on((viewID, dataID) => {
  if (viewID === displayView.value?.id && dataID === props.imageId)
    displayControls.value?.resetRangeDrafts();
});

const referenceView = computed(
  () =>
    displayView.value ??
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
  if (!displayView.value)
    return 'Open a slice or En face view showing this image to change visibility.';
  if (displayView.value.type === 'EnFace')
    return getEnFaceUnavailableReason(props.imageId) ?? '';
  return '';
});

function toggleVisibility() {
  if (visibilityUnavailableReason.value || !displayView.value) return;
  windowingStore.updateConfig(
    displayView.value.id,
    props.imageId,
    { visibility: !visibility.value },
    true
  );
}

const preset = computed(() => resolveBaseColorPreset(windowing.value?.preset));

function setPreset(value: string) {
  if (unavailableReason.value || !displayView.value) return;
  windowingStore.updateConfig(
    displayView.value.id,
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
  if (displayView.value)
    return windowingStore.getRange(displayView.value.id, props.imageId);
  const range = scalars.value?.getRange() ?? [0, 1];
  return [range[0], range[1]] as const;
});

const unavailableReason = computed(() => {
  if (!imageData.value || !scalars.value)
    return 'The image must finish loading first.';
  if (isCineImage(props.imageId))
    return 'Cine images already contain display-encoded pixels.';
  if (scalars.value.getNumberOfComponents() !== 1)
    return 'Window/level editing requires a single-component image.';
  if (!displayView.value)
    return 'Open a slice or En face view showing this image to adjust window/level.';
  if (displayView.value.type === 'EnFace')
    return getEnFaceUnavailableReason(props.imageId) ?? '';
  return '';
});

function setRange([min, max]: [number, number]) {
  const view = displayView.value;
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
    ref="displayControls"
    :key="`${imageId}:${sharesSourceWindowing(displayView) ? '' : (displayView?.id ?? '')}`"
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
        v-if="displayView"
        :view-id="displayView.id"
        :image-id="imageId"
        @change="resetRangeDrafts"
      />
    </template>
  </ImageDisplayControls>
</template>
