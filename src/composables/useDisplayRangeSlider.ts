import { computed, onBeforeUnmount, ref } from 'vue';
import { adjacentNumber } from '@/src/utils/adjacentNumber';
import { isValidDisplayRange } from '@/src/utils/isValidDisplayRange';

export type DisplayRange = readonly [number, number];
type Handle = 'min' | 'max' | 'center';

type Drag = {
  handle: Handle;
  pointerId: number;
  startX: number;
  width: number;
  dataRange: DisplayRange;
  moved: boolean;
  range: DisplayRange;
  target: HTMLButtonElement;
};

type Options = {
  modelValue: DisplayRange;
  dataRange: DisplayRange;
  disabled?: boolean;
  windowLevel?: boolean;
};

export function useDisplayRangeSlider(
  props: Options,
  updateRange: (range: [number, number]) => void
) {
  const track = ref<HTMLElement>();
  let drag: Drag | undefined;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(high, value));
  const span = computed(() => props.dataRange[1] - props.dataRange[0]);

  const valid = computed(
    () =>
      isValidDisplayRange(props.dataRange) &&
      isValidDisplayRange(props.modelValue)
  );

  const endpointLimit = (value: number, direction: number) => {
    const next = adjacentNumber(value, direction);
    // A window/level pair needs a representable midpoint between its endpoints.
    return props.windowLevel ? adjacentNumber(next, direction) : next;
  };

  const bounds = (
    handle: Handle,
    range: DisplayRange = props.modelValue,
    domain: DisplayRange = props.dataRange
  ): DisplayRange => {
    const [low, high] = domain;
    if (!valid.value) return [0, 0];
    if (handle === 'min')
      return [low, Math.min(high, endpointLimit(range[1], -1))];
    if (handle === 'max')
      return [Math.max(low, endpointLimit(range[0], 1)), high];
    const halfWidth = (range[1] - range[0]) / 2;
    const limit = Number.MAX_VALUE - halfWidth;
    const first = clamp(low + halfWidth, -limit, limit);
    const second = clamp(high - halfWidth, -limit, limit);
    // A wide window can move while continuing to cover the image range.
    return [Math.min(first, second), Math.max(first, second)];
  };

  const value = (handle: Handle, range: DisplayRange = props.modelValue) => {
    if (!isValidDisplayRange(range)) return 0;
    if (handle === 'min') return range[0];
    if (handle === 'max') return range[1];
    return range[0] + (range[1] - range[0]) / 2;
  };

  const interactionBounds = (
    handle: Handle,
    range: DisplayRange = props.modelValue,
    domain: DisplayRange = props.dataRange
  ): DisplayRange => {
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

  const update = (
    handle: Handle,
    target: number,
    range: DisplayRange,
    domain: DisplayRange = props.dataRange
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
      isValidDisplayRange(result) &&
      result.some((endpoint, index) => endpoint !== props.modelValue[index])
    )
      updateRange(result);
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
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const current = value(handle);
    let next = current + (span.value / 100) * direction;
    if (next === current) next = adjacentNumber(current, direction);
    update(handle, next, props.modelValue);
  };

  onBeforeUnmount(endDrag);

  return {
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
  };
}
