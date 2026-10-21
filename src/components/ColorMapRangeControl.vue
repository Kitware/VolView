<script setup lang="ts">
import { computed } from 'vue';
import {
  useDisplayRangeSlider,
  type DisplayRange,
} from '@/src/composables/useDisplayRangeSlider';
import { useDevicePixelRatio, useElementSize } from '@vueuse/core';
import ColorMapSwatch from './ColorMapSwatch.vue';

const props = defineProps<{
  modelValue: DisplayRange;
  dataRange: DisplayRange;
  preset: string;
  transparentBackground?: boolean;
  disabled?: boolean;
  windowLevel?: boolean;
  describedby?: string;
  testIdPrefix?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [range: [number, number]];
}>();

const testIdPrefix = computed(() => props.testIdPrefix ?? 'layer-range');

const {
  track,
  positionFraction,
  interactionBounds,
  value,
  valueText,
  overflowDirection,
  disabledReason,
  beginDrag,
  moveDrag,
  releaseDrag,
  onKeydown,
} = useDisplayRangeSlider(props, (range) => emit('update:modelValue', range));

const { width: trackWidth } = useElementSize(track);
const { pixelRatio } = useDevicePixelRatio();

// Whole device pixels keep both marks equally weighted at fractional display scales.
const centerIcon = computed(() => {
  const ratio = pixelRatio.value;
  const bar = Math.max(1, Math.round(2 * ratio));
  const gap = Math.max(1, Math.round(2 * ratio));
  const height = Math.max(1, Math.round(10 * ratio));
  const width = 2 * bar + gap;
  return {
    bar,
    gap,
    width,
    height,
    cssWidth: width / ratio,
    cssHeight: height / ratio,
  };
});

const handles = ['min', 'max', 'center'] as const;
const position = (handle: (typeof handles)[number]) =>
  `${positionFraction(handle) * 100}%`;

const projectedWindowWidth = computed(
  () => positionFraction('max') - positionFraction('min')
);

const overlapping = computed(() => {
  const center = positionFraction('center');
  return (
    Math.min(
      center - positionFraction('min'),
      positionFraction('max') - center
    ) *
      trackWidth.value <
    24
  );
});

const title = (handle: (typeof handles)[number]) =>
  disabledReason() ||
  (overflowDirection(handle)
    ? valueText(handle)
    : handle === 'center'
      ? 'Move the display window'
      : 'Adjust display range ' + (handle === 'min' ? 'minimum' : 'maximum'));
</script>

<template>
  <div class="range-control" :data-testid="`${testIdPrefix}-slider`">
    <div
      ref="track"
      class="palette-window-bar"
      :class="{ overlapping }"
      :style="{ '--window-width': `${projectedWindowWidth * 100}%` }"
      :data-testid="
        testIdPrefix === 'layer-range'
          ? 'palette-window-bar'
          : `${testIdPrefix}-bar`
      "
    >
      <ColorMapSwatch
        class="palette-window-colors"
        :preset="preset"
        :domain="dataRange"
        :mapping-range="modelValue"
        :transparent-background="transparentBackground"
        aria-hidden="true"
      />
      <span
        v-for="handle in handles"
        :key="handle"
        class="handle-position"
        :class="`handle-position-${handle}`"
        :style="{
          left: position(handle),
          zIndex: disabledReason() ? 0 : undefined,
        }"
        :title="title(handle)"
      >
        <button
          type="button"
          role="slider"
          class="range-handle"
          :class="`range-handle-${handle}`"
          :data-testid="`${testIdPrefix}-${handle}-handle`"
          :aria-label="`Display range ${handle === 'min' ? 'minimum' : handle === 'max' ? 'maximum' : 'center'}`"
          :aria-valuemin="interactionBounds(handle)[0]"
          :aria-valuemax="interactionBounds(handle)[1]"
          :aria-valuenow="value(handle)"
          :aria-valuetext="valueText(handle)"
          :aria-describedby="describedby"
          aria-orientation="horizontal"
          :disabled="!!disabledReason()"
          :tabindex="disabledReason() ? -1 : 0"
          @pointerdown.stop.prevent="beginDrag($event, handle)"
          @pointermove.stop.prevent="moveDrag"
          @pointerup.stop="releaseDrag"
          @pointercancel.stop="releaseDrag"
          @lostpointercapture="releaseDrag"
          @click.stop
          @keydown="onKeydown($event, handle)"
        >
          <span
            class="handle-grip"
            :data-direction="overflowDirection(handle)"
            aria-hidden="true"
          >
            <v-icon v-if="overflowDirection(handle)" size="14">
              {{
                overflowDirection(handle) === 'left'
                  ? 'mdi-chevron-left'
                  : 'mdi-chevron-right'
              }}
            </v-icon>
            <svg
              v-else-if="handle === 'center'"
              :width="centerIcon.cssWidth"
              :height="centerIcon.cssHeight"
              :viewBox="`0 0 ${centerIcon.width} ${centerIcon.height}`"
              fill="currentColor"
              shape-rendering="crispEdges"
              focusable="false"
            >
              <rect :width="centerIcon.bar" :height="centerIcon.height" />
              <rect
                :x="centerIcon.bar + centerIcon.gap"
                :width="centerIcon.bar"
                :height="centerIcon.height"
              />
            </svg>
          </span>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.range-control {
  width: 100%;
  padding: 6px 12px 18px;
  touch-action: none;
  user-select: none;
}
.palette-window-bar {
  position: relative;
  width: 100%;
  height: 32px;
}
.palette-window-colors {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 4px;
}
.handle-position {
  position: absolute;
  top: 50%;
  width: min(24px, calc(12px + var(--window-width) / 2));
  height: 24px;
  z-index: 1;
}
/* Split overlapping hit targets at their midpoint to keep both ends draggable. */
.handle-position-min {
  transform: translate(-12px, -50%);
}
.handle-position-max {
  transform: translate(calc(12px - 100%), -50%);
}
.handle-position:focus-within {
  z-index: 2;
}
.range-handle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: ew-resize;
  touch-action: none;
}
.handle-grip {
  position: absolute;
  top: 12px;
  pointer-events: none;
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-variant));
  color: color-mix(
    in srgb,
    rgb(var(--v-theme-surface-variant)) 38%,
    rgb(var(--v-theme-surface))
  );
  isolation: isolate;
}
.handle-grip[data-direction] {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.handle-grip::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgb(var(--v-theme-surface-variant));
  pointer-events: none;
  opacity: 0;
  z-index: -1;
  transition:
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.3s;
}
@media (hover: hover) {
  .range-handle:hover:not(:disabled) .handle-grip::before {
    transform: scale(2);
    opacity: var(--v-hover-opacity);
  }
}
.range-handle:focus-visible .handle-grip::before {
  transform: scale(2);
  opacity: var(--v-focus-opacity);
}
.range-handle:active:not(:disabled) .handle-grip::before {
  transform: scale(2);
  opacity: var(--v-pressed-opacity);
}
@media (prefers-reduced-motion: reduce) {
  .handle-grip::before {
    transition: none;
  }
}
.range-handle-min .handle-grip {
  left: 12px;
  transform: translate(-50%, -50%);
}
.range-handle-max .handle-grip {
  right: 12px;
  transform: translate(50%, -50%);
}
.handle-position-center {
  width: 24px;
  transform: translate(-50%, -50%);
}
.range-handle-center .handle-grip {
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.range-handle-center svg {
  display: block;
  overflow: visible;
}
.overlapping .handle-position {
  height: 12px;
}
.overlapping .handle-position-min,
.overlapping .handle-position-max {
  top: calc(50% - 6px);
}
.overlapping .handle-position-center {
  top: calc(50% + 6px);
}
.overlapping .range-handle-center .handle-grip {
  top: 0;
}
.range-handle:focus-visible {
  outline: none;
}
.range-handle:focus-visible .handle-grip {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.range-handle:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
