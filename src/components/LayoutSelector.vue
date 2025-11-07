<script setup lang="ts">
import { computed } from 'vue';
import { useViewStore } from '@/src/store/views';
import LayoutGridEditor from './LayoutGridEditor.vue';

const viewStore = useViewStore();

const layoutGridSize = computed({
  get: () => [0, 0] as [number, number],
  set: (size: [number, number]) => {
    viewStore.setLayoutFromGrid(size);
  },
});

const namedLayoutsList = computed(() => {
  return Object.keys(viewStore.namedLayouts);
});

const selectNamedLayout = (name: string) => {
  viewStore.switchToNamedLayout(name);
};
</script>

<template>
  <div>
    <div v-if="namedLayoutsList.length > 0" class="named-layouts">
      <v-list density="compact">
        <v-list-item
          v-for="name in namedLayoutsList"
          :key="name"
          :active="viewStore.currentLayoutName === name"
          @click="selectNamedLayout(name)"
        >
          <v-list-item-title>{{ name }}</v-list-item-title>
        </v-list-item>
      </v-list>
      <v-divider class="my-2" />
    </div>
    <div class="grid-editor">
      <LayoutGridEditor v-model="layoutGridSize" />
    </div>
  </div>
</template>

<style scoped>
.named-layouts {
  padding-bottom: 8px;
}

.grid-editor {
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
