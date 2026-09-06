<script setup lang="ts">
import { useRulerStore } from '@/src/store/tools/rulers';
import SegmentTypeList from '@/src/components/SegmentTypeList.vue';

const activeToolStore = useRulerStore();
</script>

<template>
  <segment-type-list :registry="activeToolStore.types" />
</template>
