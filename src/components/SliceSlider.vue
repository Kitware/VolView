<template>
  <div
    class="slice-slider"
    ref="handleContainer"
  >
  <div
    class="slice-slider-handle"
    ref="handle"
    :style="{
      height: `${handleHeight}px`,
      transform: `translate3d(0, ${handlePosition}px, 0)`,
    }"
    @mousedown="onDragStart"
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
    slice: {
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
    handleHeight: {
      type: Number,
      default: 20,
    },
  },

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
      const pos = this.maxHandlePos
        * ((this.slice - this.min) / (this.max - this.min));
      return this.dragging ? this.draggingHandlePos : pos;
    },
    draggingHandlePos() {
      return Math.min(
        Math.max(0, this.initialHandlePos + this.yOffset),
        this.maxHandlePos,
      );
    },
  },

  mounted() {
    this.updateMaxHandlePos();
    this.$eventBus.$on('resize', this.updateMaxHandlePos);
  },

  beforeDestroy() {
    this.$eventBus.$off('resize', this.updateMaxHandlePos);
  },

  methods: {
    updateMaxHandlePos() {
      this.maxHandlePos = this.$refs.handleContainer.clientHeight
        - this.handleHeight;
    },

    onDragStart(ev) {
      ev.preventDefault();

      this.dragging = true;
      this.initialMousePosY = ev.pageY;
      const handleStyles = window.getComputedStyle(this.$refs.handle);
      this.initialHandlePos = getYOffsetFromTransform(handleStyles.transform);
      this.yOffset = 0;

      document.addEventListener('mousemove', this.onDragMove);
      document.addEventListener('mouseup', this.onDragEnd);
    },

    onDragMove(ev) {
      ev.preventDefault();

      this.yOffset = ev.pageY - this.initialMousePosY;
      const slice = this.getNearestSlice();
      this.$emit('input', slice);
    },

    onDragEnd(ev) {
      ev.preventDefault();

      this.dragging = false;
      document.removeEventListener('mousemove', this.onDragMove);
      document.removeEventListener('mouseup', this.onDragEnd);
      const slice = this.getNearestSlice();
      this.$emit('input', slice);
    },

    getNearestSlice() {
      const sliceEstimate = this.handlePosition / this.maxHandlePos;
      return Math.round(sliceEstimate * (this.max - this.min)) + this.min;
    },
  },
};
</script>

<style scoped>
.slice-slider-handle {
  position: absolute;
  width: 100%;
  background: pink;
}
</style>
