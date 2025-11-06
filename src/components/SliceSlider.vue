<template>
  <div
    class="slice-slider"
    ref="handleContainer"
    @pointerdown="onDragStart"
    @pointermove="onDragMove"
    @pointerup="onDragEnd"
    @pointercancel="onDragEnd"
    @contextmenu="$event.preventDefault()"
  >
    <div class="slice-slider-track" />
    <div
      class="slice-slider-handle"
      ref="handle"
      :style="{
        height: `${handleHeight}px`,
        transform: `translate3d(0, ${handlePosition}px, 0)`,
      }"
    />
  </div>
</template>

<script>
function getYOffsetFromTransform(matStr) {
  if (!matStr || matStr === 'none') {
    return 0;
  }
  const values = matStr
    .match(/matrix(?:3d)?\((.+)\)/)[1]
    .split(',')
    .map((v) => Number(v));
  const is3D = matStr.includes('3d');
  return is3D ? values[13] : values[5];
}

export default {
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
    min: {
      type: Number,
      required: true,
    },
    max: {
      type: Number,
      required: true,
    },
    step: {
      type: Number,
      required: true,
    },
    handleHeight: {
      type: Number,
      default: 20,
    },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      maxHandlePos: 0,
      dragging: false,
      initialHandlePos: 0,
      initialMousePosY: 0,
      yOffset: 0,
    };
  },

  computed: {
    handlePosition() {
      const range = this.max - this.min <= 0 ? 1 : this.max - this.min;
      // Invert mapping: lower slice numbers at bottom for anatomical consistency
      const pos =
        this.maxHandlePos * (1 - (this.modelValue - this.min) / range);
      return this.dragging ? this.draggingHandlePos : pos;
    },
    draggingHandlePos() {
      return Math.min(
        Math.max(0, this.initialHandlePos + this.yOffset),
        this.maxHandlePos
      );
    },
  },

  mounted() {
    this.updateMaxHandlePos();
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 1) {
        this.updateMaxHandlePos();
      }
    });
    this.resizeObserver.observe(this.$refs.handleContainer);
  },

  beforeUnmount() {
    this.resizeObserver.disconnect();
  },

  methods: {
    updateMaxHandlePos() {
      this.maxHandlePos =
        this.$refs.handleContainer.clientHeight - this.handleHeight;
    },

    onDragStart(ev) {
      ev.preventDefault();

      this.dragging = true;
      this.initialMousePosY = ev.pageY;

      if (ev.target === this.$refs.handle) {
        const handleStyles = window.getComputedStyle(this.$refs.handle);
        this.initialHandlePos = getYOffsetFromTransform(handleStyles.transform);
      } else {
        // move handle to mouse pos
        const { y } = this.$refs.handleContainer.getBoundingClientRect();
        this.initialHandlePos = Math.max(
          0,
          Math.min(this.maxHandlePos, ev.pageY - y - this.handleHeight / 2)
        );
        const newSlice = this.getNearestSlice(this.initialHandlePos);
        this.$emit('update:modelValue', newSlice);
      }

      this.yOffset = 0;

      this.$refs.handleContainer.setPointerCapture(ev.pointerId);
    },

    onDragMove(ev) {
      if (!this.$refs.handleContainer.hasPointerCapture(ev.pointerId)) return;
      ev.preventDefault();

      this.yOffset = ev.pageY - this.initialMousePosY;
      const slice = this.getNearestSlice(this.handlePosition);
      this.$emit('update:modelValue', slice);
    },

    onDragEnd(ev) {
      if (!this.$refs.handleContainer.hasPointerCapture(ev.pointerId)) return;
      ev.preventDefault();
      this.$refs.handleContainer.releasePointerCapture(ev.pointerId);

      this.dragging = false;
      const slice = this.getNearestSlice(this.handlePosition);
      this.$emit('update:modelValue', slice);
    },

    getNearestSlice(pos) {
      // Invert position: bottom of slider = lower slice numbers
      const sliceEstimate = 1 - pos / this.maxHandlePos;
      const frac = sliceEstimate * (this.max - this.min) + this.min;
      return Math.round(frac / this.step) * this.step;
    },
  },
};
</script>

<style scoped>
.slice-slider {
  touch-action: none;
}

.slice-slider-handle {
  position: relative;
  width: 100%;
  background: #ccc;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px solid #999;
}

.slice-slider-track {
  position: absolute;
  margin: 0 auto;
  top: 8px;
  left: 0;
  right: 0;
  bottom: 8px;
  width: 1px;
  border: 1px solid #888;
  border-radius: 2px;
}
</style>
