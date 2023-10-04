<template>
  <v-list density="compact" v-if="labelmaps.length">
    <v-list-item v-for="id in labelmaps" :key="id" lines="two">
      <v-list-item-title>Labelmap (ID = {{ id }})</v-list-item-title>
    </v-list-item>
  </v-list>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useLabelmapStore } from '../store/datasets-labelmaps';

export default defineComponent({
  name: 'LabelmapList',
  setup() {
    const labelmapStore = useLabelmapStore();
    const { currentImageID } = useCurrentImage();

    const labelmaps = computed(() => {
      if (!currentImageID.value) return [];
      return labelmapStore.orderByParent[currentImageID.value];
    });

    return {
      labelmaps,
    };
  },
});
</script>
