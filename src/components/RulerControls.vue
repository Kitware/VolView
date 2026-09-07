<script setup lang="ts">
import { useRulerStore } from '@/src/store/tools/rulers';
import SegmentPicker from '@/src/components/SegmentPicker.vue';

const activeToolStore = useRulerStore();
</script>

<template>
  <segment-picker :registry="activeToolStore.segments" />
</template>
