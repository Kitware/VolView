<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useDevicePixelRatio, useElementSize } from '@vueuse/core';
import ColorMapSwatch from './ColorMapSwatch.vue';

type Range = readonly [number, number];
type Handle = 'min' | 'max' | 'center';
type Drag = {
  handle: Handle;
  pointerId: number;
  startX: number;
  width: number;
  dataRange: Range;
  moved: boolean;
  range: Range;
  target: HTMLButtonElement;
};

const props = defineProps<{
  modelValue: Range;
  dataRange: Range;
  preset: string;
  transparentBackground?: boolean;
  disabled?: boolean;
  describedby?: string;
  testIdPrefix?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [range: [number, number]];
}>();
const testIdPrefix = computed(() => props.testIdPrefix ?? 'layer-range');
const track = ref<HTMLElement>();
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
let drag: Drag | undefined;
const handles = ['min', 'max', 'center'] as const;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const span = computed(() => props.dataRange[1] - props.dataRange[0]);
const validRange = (range: Range) =>
  range.every(Number.isFinite) &&
  range[0] < range[1] &&
  Number.isFinite(range[1] - range[0]);
const valid = computed(
  () => validRange(props.dataRange) && validRange(props.modelValue)
);

// Adjacent floating-point values keep even very narrow windows from collapsing.
const adjacent = (value: number, direction: number) => {
  if (value === 0) return direction * Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + BigInt((value > 0 ? 1 : -1) * direction));
  return view.getFloat64(0);
};
const bounds = (
  handle: Handle,
  range: Range = props.modelValue,
  domain: Range = props.dataRange
): Range => {
  const [low, high] = domain;
  if (!valid.value) return [0, 0];
  if (handle === 'min') return [low, Math.min(high, adjacent(range[1], -1))];
  if (handle === 'max') return [Math.max(low, adjacent(range[0], 1)), high];
  const halfWidth = (range[1] - range[0]) / 2;
  const limit = Number.MAX_VALUE - halfWidth;
  const first = clamp(low + halfWidth, -limit, limit);
  const second = clamp(high - halfWidth, -limit, limit);
  // A wide window can move while continuing to cover the image range.
  return [Math.min(first, second), Math.max(first, second)];
};
const value = (handle: Handle, range: Range = props.modelValue) => {
  if (!validRange(range)) return 0;
  if (handle === 'min') return range[0];
  if (handle === 'max') return range[1];
  return range[0] + (range[1] - range[0]) / 2;
};
const interactionBounds = (
  handle: Handle,
  range: Range = props.modelValue,
  domain: Range = props.dataRange
): Range => {
  const [low, high] = bounds(handle, range, domain);
  const current = value(handle, range);
  // Preserve an out-of-range starting value until the gesture brings it inward.
  return [Math.min(low, current), Math.max(high, current)];
};
const disabledReason = () => {
  if (props.disabled) return 'Display range controls are unavailable.';
  if (!valid.value)
    return 'A finite, nonconstant image and display range is required.';
  return '';
};
const overflowDirection = (handle: Handle) => {
  if (!valid.value) return undefined;
  const current = value(handle);
  if (current < props.dataRange[0]) return 'left';
  if (current > props.dataRange[1]) return 'right';
  return undefined;
};
const valueText = (handle: Handle) => {
  const outside = overflowDirection(handle);
  return outside
    ? String(value(handle)) +
        (outside === 'left' ? ' (below image range)' : ' (above image range)')
    : String(value(handle));
};
const positionFraction = (handle: Handle) =>
  valid.value
    ? (clamp(value(handle), ...props.dataRange) - props.dataRange[0]) /
      span.value
    : 0.5;
const position = (handle: Handle) => `${positionFraction(handle) * 100}%`;
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
const title = (handle: Handle) =>
  disabledReason() ||
  (overflowDirection(handle)
    ? valueText(handle)
    : handle === 'center'
      ? 'Move the display window'
      : 'Adjust display range ' + (handle === 'min' ? 'minimum' : 'maximum'));
const update = (
  handle: Handle,
  target: number,
  range: Range,
  domain: Range = props.dataRange
) => {
  if (disabledReason() || !Number.isFinite(target)) return;
  const [low, high] = interactionBounds(handle, range, domain);
  const next = clamp(target, low, high);
  let result: [number, number];
  if (handle === 'min') result = [next, range[1]];
  else if (handle === 'max') result = [range[0], next];
  else {
    const width = range[1] - range[0];
    const first = Math.min(domain[0], Number.MAX_VALUE - width);
    const second = Math.max(-Number.MAX_VALUE, domain[1] - width);
    const delta = next - value('center', range);
    const minimum = clamp(
      Number.isFinite(delta) ? range[0] + delta : next - width / 2,
      Math.min(first, second, range[0]),
      Math.max(first, second, range[0])
    );
    result = [minimum, minimum + width];
  }
  if (
    validRange(result) &&
    result.some((endpoint, index) => endpoint !== props.modelValue[index])
  )
    emit('update:modelValue', result);
};
const endDrag = () => {
  const previous = drag;
  drag = undefined;
  if (previous?.target.hasPointerCapture(previous.pointerId))
    previous.target.releasePointerCapture(previous.pointerId);
};
const beginDrag = (event: PointerEvent, handle: Handle) => {
  if (drag || disabledReason() || event.button !== 0) return;
  const width = track.value?.getBoundingClientRect().width;
  if (!width) return;
  const target = event.currentTarget as HTMLButtonElement;
  target.focus({ preventScroll: true });
  target.setPointerCapture(event.pointerId);
  drag = {
    handle,
    target,
    pointerId: event.pointerId,
    startX: event.clientX,
    width,
    dataRange: [...props.dataRange],
    moved: false,
    range: [...props.modelValue],
  };
};
const moveDrag = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && event.clientX === drag.startX) return;
  drag.moved = true;
  const scalarSpan = drag.dataRange[1] - drag.dataRange[0];
  const delta = ((event.clientX - drag.startX) / drag.width) * scalarSpan;
  update(
    drag.handle,
    value(drag.handle, drag.range) + delta,
    drag.range,
    drag.dataRange
  );
};
const releaseDrag = (event: PointerEvent) => {
  if (drag?.pointerId === event.pointerId) endDrag();
};
const onKeydown = (event: KeyboardEvent, handle: Handle) => {
  const directions: Record<string, number> = {
    ArrowLeft: -1,
    ArrowDown: -1,
    ArrowRight: 1,
    ArrowUp: 1,
    PageDown: -10,
    PageUp: 10,
  };
  const direction = directions[event.key];
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  event.stopPropagation();
  const current = value(handle);
  const [low, high] = bounds(handle);
  let next = current + (span.value / 100) * direction;
  if (event.key === 'Home') next = low;
  else if (event.key === 'End') next = high;
  else if (next === current) next = adjacent(current, Math.sign(direction));
  update(handle, next, props.modelValue);
};
onBeforeUnmount(endDrag);
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
  height: 16px;
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
