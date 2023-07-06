<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useRectangleStore } from '../store/tools/rectangles';
import { RectangleID } from '../types/rectangle';

export default defineComponent({
  setup() {
    const rectStore = useRectangleStore();
    const { currentImageID } = useCurrentImage();

    const rects = computed(() =>
      rectStore.tools.filter(
        (rect) => !rect.placing && rect.imageID === currentImageID.value
      )
    );

    function remove(id: RectangleID) {
      rectStore.removeTool(id);
    }

    function jumpTo(id: RectangleID) {
      rectStore.jumpToTool(id);
    }

    return {
      rects,
      remove,
      jumpTo,
    };
  },
});
</script>

<template>
  <v-list-item v-for="rect in rects" :key="rect.id" lines="two">
    <template #prepend>
      <v-icon class="tool-icon">mdi-vector-square</v-icon>
      <div class="color-dot mr-3" :style="{ backgroundColor: rect.color }" />
    </template>
    <v-list-item-title v-bind="$attrs">
      {{ rect.labelName }}
    </v-list-item-title>

    <v-list-item-subtitle>
      <v-row>
        <v-col>ID: {{ rect.id }}</v-col>
      </v-row>
    </v-list-item-subtitle>
    <template #append>
      <v-row>
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

.tool-icon {
  margin-inline-end: 12px;
}
</style>
