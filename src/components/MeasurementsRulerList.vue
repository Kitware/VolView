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
      return rulerStore.rulerIDs
        .map((id) => [id, rulerStore.rulers[id]] as const)
        .filter(([, ruler]) => ruler.imageID === imageID)
        .map(([id, ruler]) => ({
          id,
          length: rulerStore.lengthByID[id],
          color: ruler.color,
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
      <v-menu location="end" :close-on-content-click="false">
        <template v-slot:activator="{ props }">
          <div
            class="color-dot clickable mr-3"
            :style="{ backgroundColor: ruler.color }"
            v-bind="props"
          />
        </template>
        <v-color-picker
          :model-value="ruler.color"
          @update:model-value="updateColor(ruler.id, $event)"
          hide-inputs
          class="overflow-hidden"
        />
      </v-menu>
    </template>
    <v-list-item-title v-bind="$attrs">
      Ruler (ID = {{ ruler.id }})
    </v-list-item-title>
    <v-list-item-subtitle>
      Length: {{ ruler.length.toFixed(2) }}mm
    </v-list-item-subtitle>
    <template #append>
      <v-row no-gutters>
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
</style>
