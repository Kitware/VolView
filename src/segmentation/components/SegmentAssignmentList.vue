<script setup lang="ts">
import { useSegmentStore } from '@/src/segmentation/segments';

defineProps<{ segmentId?: string }>();
defineEmits<{ select: [segmentId: string] }>();

const registry = useSegmentStore().segments;
</script>

<template>
  <v-list density="compact">
    <v-list-item
      v-for="segment in registry.segmentList.value"
      :key="segment.id"
      :active="segment.id === segmentId"
      @click="$emit('select', segment.id)"
    >
      <template #prepend>
        <span
          class="color-dot mr-2"
          :style="{
            backgroundColor: registry.appearanceOf(segment.id).cssColor,
          }"
        />
      </template>
      <v-list-item-title>
        {{ registry.appearanceOf(segment.id).name }}
      </v-list-item-title>
    </v-list-item>
  </v-list>
</template>

<style scoped>
.color-dot {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #111;
}
</style>
