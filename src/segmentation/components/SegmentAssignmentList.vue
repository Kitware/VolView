<script setup lang="ts">
import { computed } from 'vue';
import ColorDot from '@/src/components/ColorDot.vue';
import { useSegmentStore } from '@/src/segmentation/segments';

defineProps<{ segmentId?: string }>();
defineEmits<{ select: [segmentId: string] }>();

const registry = useSegmentStore().segments;

const items = computed(() =>
  registry.segmentList.value.map(({ id }) => {
    const { displayName, cssColor } = registry.appearanceOf(id);
    return { id, name: displayName, cssColor };
  })
);
</script>

<template>
  <v-list density="compact">
    <v-list-item
      v-for="item in items"
      :key="item.id"
      :active="item.id === segmentId"
      @click="$emit('select', item.id)"
    >
      <template #prepend>
        <color-dot class="mr-2" :color="item.cssColor" />
      </template>
      <v-list-item-title>{{ item.name }}</v-list-item-title>
    </v-list-item>
  </v-list>
</template>
