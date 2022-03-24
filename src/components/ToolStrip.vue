<template>
  <item-group mandatory :value="currentTool" @change="setCurrentTool($event)">
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.WindowLevel"
    >
      <tool-button
        size="40"
        icon="mdi-circle-half-full"
        name="Window & Level"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <tool-button
        size="40"
        icon="mdi-brush"
        name="Paint"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <tool-button
        size="40"
        icon="mdi-ruler"
        name="Ruler"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Crosshairs"
    >
      <tool-button
        size="40"
        icon="mdi-crosshairs"
        name="Crosshairs"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';
import { useDatasetStore } from '../storex/datasets';
import { Tools, useToolStore } from '../store/tools';

export default defineComponent({
  components: {
    ToolButton,
    ItemGroup,
    GroupableItem,
  },
  setup() {
    const dataStore = useDatasetStore();
    const toolStore = useToolStore();

    const noCurrentImage = computed(() => !dataStore.primaryDataset);
    const currentTool = computed(() => toolStore.currentTool);

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      Tools,
    };
  },
});
</script>

<style>
.tool-btn-selected {
  background-color: rgba(128, 128, 255, 0.7);
}
</style>
