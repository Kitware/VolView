<script setup lang="ts">
import { usePolygonStore } from '@src/store/tools/polygons';
import LabelControls from '@src/components/LabelControls.vue';

const activeToolStore = usePolygonStore();
</script>

<template>
  <LabelControls :labelsStore="activeToolStore" />
</template>
