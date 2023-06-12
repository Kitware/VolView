<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useRulerStore } from '../store/tools/rulers';

export default defineComponent({
  setup() {
    const rulerStore = useRulerStore();
    const { currentImageID } = useCurrentImage();

    const rulers = computed(() => {
      const imageID = currentImageID.value;
      const { lengthByID } = rulerStore;
      return rulerStore.rulers
        .filter((ruler) => ruler.imageID === imageID && !ruler.placing)
        .map((ruler) => ({
          id: ruler.id,
          name: ruler.name,
          length: lengthByID[ruler.id],
          color: ruler.color,
          label: ruler.label,
        }));
    });

    function remove(id: string) {
      rulerStore.removeRuler(id);
    }

    function jumpTo(id: string) {
      rulerStore.jumpToRuler(id);
    }

    function updateColor(id: string, color: string) {
      rulerStore.updateRuler(id, { color });
    }

    return {
      rulers,
      remove,
      jumpTo,
      updateColor,
    };
  },
});
</script>

<template>
  <v-list-item v-for="ruler in rulers" :key="ruler.id" lines="two">
    <template #prepend>
      <v-icon class="tool-icon">mdi-ruler</v-icon>
      <div class="color-dot mr-3" :style="{ backgroundColor: ruler.color }" />
    </template>
    <v-list-item-title v-bind="$attrs">
      {{ ruler.label }}
    </v-list-item-title>
    <v-list-item-subtitle>
      <v-row>
        <v-col
          >Length:
          <span class="value">{{ ruler.length.toFixed(2) }}mm</span>
        </v-col>
        <v-col>ID: {{ ruler.id }}</v-col>
      </v-row>
    </v-list-item-subtitle>
    <template #append>
      <v-row>
        <v-btn
          class="mr-2"
          icon="mdi-target"
          variant="text"
          @click="jumpTo(ruler.id)"
        >
          <v-icon>mdi-target</v-icon>
          <v-tooltip location="top" activator="parent">
            Reveal Slice
          </v-tooltip>
        </v-btn>
        <v-btn icon="mdi-delete" variant="text" @click="remove(ruler.id)">
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
