<script setup lang="ts">
import { shallowRef } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: [number, number];
  }>(),
  {
    modelValue: () => [0, 0],
  }
);

const emits = defineEmits<{
  'update:model-value': [[number, number]];
}>();

const MAX_WIDTH = 3;
const MAX_HEIGHT = 3;

console.log(props);
const internalSelection = shallowRef<[number, number]>([
  props.modelValue[0],
  props.modelValue[1],
]);

function setModelFromInternal() {
  emits('update:model-value', internalSelection.value);
}

function resetSelection() {
  internalSelection.value = [props.modelValue[0], props.modelValue[1]];
}

function setSelectionFromIndex(idx: number) {
  internalSelection.value = [
    (idx % MAX_WIDTH) + 1,
    Math.floor(idx / MAX_WIDTH) + 1,
  ];
}

function isIndexInSelection(idx: number) {
  const y = Math.floor(idx / MAX_HEIGHT);
  const x = idx % MAX_WIDTH;
  return x < internalSelection.value[0] && y < internalSelection.value[1];
}
</script>

<template>
  <div
    class="grid-container"
    @pointerleave="resetSelection()"
    @pointerdown="setModelFromInternal()"
  >
    <div
      v-for="i in MAX_WIDTH * MAX_HEIGHT"
      :key="i"
      class="grid-cell"
      @pointerenter="setSelectionFromIndex(i - 1)"
    >
      <div
        :class="[
          'grid-cell-box',
          isIndexInSelection(i - 1) && 'grid-cell-box-selected',
        ]"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.grid-container {
  display: grid;
  grid-template-columns: repeat(3, 32px);
  grid-template-rows: repeat(3, 32px);
}

.grid-cell {
  cursor: pointer;
}

.grid-cell-box {
  width: calc(100% - 2px);
  height: calc(100% - 2px);
  background-color: rgba(72, 72, 72, 0.5);
}

.grid-cell-box-selected {
  background-color: rgba(120, 120, 120);
}
</style>
