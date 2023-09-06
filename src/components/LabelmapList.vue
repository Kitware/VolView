<template>
  <v-list density="compact" v-if="labelmaps.length">
    <v-list-item v-for="lm in labelmaps" :key="lm.id" lines="two">
      <v-list-item-title>Labelmap (ID = {{ lm.id }})</v-list-item-title>
    </v-list-item>
  </v-list>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useLabelmapStore } from '../store/datasets-labelmaps';

export default defineComponent({
  name: 'LabelmapList',
  setup() {
    const labelmapStore = useLabelmapStore();

    const labelmaps = computed(() =>
      labelmapStore.idList.map((id) => ({ id }))
    );

    return {
      labelmaps,
    };
  },
});
</script>
