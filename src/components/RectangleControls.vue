<script setup lang="ts">
import { useRectangleStore } from '@src/store/tools/rectangles';
import LabelControls from '@src/components/LabelControls.vue';

const activeToolStore = useRectangleStore();
</script>

<template>
  <label-controls :labels-store="activeToolStore" />
</template>
