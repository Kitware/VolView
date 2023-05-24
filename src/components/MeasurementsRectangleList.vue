<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useRectangleStore } from '../store/tools/rectangles';
import { RectangleID } from '../types/rectangle';

export default defineComponent({
  setup() {
    const rectStore = useRectangleStore();
    const { currentImageID } = useCurrentImage();

    const rects = computed(() => {
      const imageID = currentImageID.value;
      return rectStore.tools
        .filter((rect) => rect.imageID === imageID && !rect.placing)
        .map((rect) => ({
          id: rect.id,
          name: rect.name,
          color: rect.color,
        }));
    });

    function remove(id: RectangleID) {
      rectStore.removeTool(id);
    }

    function jumpTo(id: RectangleID) {
      rectStore.jumpToTool(id);
    }

    function updateColor(id: RectangleID, color: string) {
      rectStore.updateTool(id, { color });
    }

    return {
      rects,
      remove,
      jumpTo,
      updateColor,
    };
  },
});
</script>

<template>
  <v-list-item v-for="rect in rects" :key="rect.id" lines="two">
    <template #prepend>
      <v-menu location="end" :close-on-content-click="false">
        <template v-slot:activator="{ props }">
          <div
            class="color-dot clickable mr-3"
            :style="{ backgroundColor: rect.color }"
            v-bind="props"
          />
        </template>
        <v-color-picker
          :model-value="rect.color"
          @update:model-value="updateColor(rect.id, $event)"
          hide-inputs
          class="overflow-hidden"
        />
      </v-menu>
    </template>
    <v-list-item-title v-bind="$attrs">
      {{ rect.name }} (ID = {{ rect.id }})
    </v-list-item-title>
    <template #append>
      <v-row no-gutters>
        <v-btn
          class="mr-2"
          icon="mdi-target"
          variant="text"
          @click="jumpTo(rect.id)"
        >
          <v-icon>mdi-target</v-icon>
          <v-tooltip location="top" activator="parent">
            Reveal Slice
          </v-tooltip>
        </v-btn>
        <v-btn icon="mdi-delete" variant="text" @click="remove(rect.id)">
          <v-icon>mdi-delete</v-icon>
          <v-tooltip location="top" activator="parent">Delete</v-tooltip>
        </v-btn>
      </v-row>
    </template>
  </v-list-item>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.empty-state {
  text-align: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
}
</style>
