<template>
  <v-list dense v-if="labelmaps.length">
    <v-list-item v-for="lm in labelmaps" :key="lm.id" two-line>
      <v-list-item-content>
        <v-list-item-title>Labelmap (ID = {{ lm.id }})</v-list-item-title>
      </v-list-item-content>
    </v-list-item>
  </v-list>
  <div v-else class="caption empty-state">No labelmaps yet</div>
</template>

<style scoped>
.empty-state {
  text-align: center;
}
</style>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
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
