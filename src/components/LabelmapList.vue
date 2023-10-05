<script setup lang="ts">
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useLabelmapStore } from '@/src/store/datasets-labelmaps';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { computed } from 'vue';

const labelmapStore = useLabelmapStore();
const { currentImageID } = useCurrentImage();

const currentLabelmaps = computed(() => {
  if (!currentImageID.value) return [];
  if (!(currentImageID.value in labelmapStore.orderByParent)) return [];
  return labelmapStore.orderByParent[currentImageID.value].map((id) => {
    return {
      id,
      name: labelmapStore.labelmapMetadata[id].name,
    };
  });
});

const paintStore = usePaintToolStore();
const targetPaintLabelmap = computed({
  get: () => paintStore.activeLabelmapID,
  set: (id) => paintStore.setActiveLabelmap(id),
});
</script>

<template>
  <v-radio-group v-model="targetPaintLabelmap">
    <v-radio
      v-for="labelmap in currentLabelmaps"
      :key="labelmap.id"
      :label="labelmap.name"
      :value="labelmap.id"
    />
  </v-radio-group>
</template>
