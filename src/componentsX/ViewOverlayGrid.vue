<template>
  <div :class="$style.gridRoot">
    <div :class="[$style.top, $style.row]">
      <div :class="[$style.left, $style.cell]">
        <slot name="top-left" />
      </div>
      <div :class="[$style.center, $style.cell]">
        <slot name="top-middle" />
      </div>
      <div :class="[$style.right, $style.cell]">
        <slot name="top-right" />
      </div>
    </div>
    <div :class="[$style.middle, $style.row]">
      <div :class="[$style.left, $style.cell]">
        <slot name="middle-left" />
      </div>
      <div :class="[$style.center, $style.cell]">
        <slot name="middle-center" />
      </div>
      <div :class="[$style.right, $style.cell]">
        <slot name="middle-right" />
      </div>
    </div>
    <div :class="[$style.bottom, $style.row]">
      <div :class="[$style.left, $style.cell]">
        <slot name="bottom-left" />
      </div>
      <div :class="[$style.center, $style.cell]">
        <slot name="bottom-center" />
      </div>
      <div :class="[$style.right, $style.cell]">
        <slot name="bottom-right" />
      </div>
    </div>
  </div>
</template>

<style module>
.gridRoot {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.row {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

.cell {
  flex: 1;
}

.top,
.left {
  align-items: flex-start;
}

.center,
.middle {
  align-items: center;
}

.bottom,
.right {
  align-items: flex-end;
}

.left {
  text-align: left;
}

.center {
  text-align: center;
}

.right {
  text-align: right;
}
</style>
