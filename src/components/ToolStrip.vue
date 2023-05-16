<template>
  <item-group
    mandatory
    :model-value="currentTool"
    @update:model-value="setCurrentTool($event)"
  >
    <div class="my-1 tool-separator" />
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.WindowLevel"
    >
      <tool-button
        size="40"
        icon="mdi-circle-half-full"
        name="Window & Level"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <tool-button
        size="40"
        icon="mdi-cursor-move"
        name="Pan"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <tool-button
        size="40"
        icon="mdi-magnify-plus-outline"
        name="Zoom"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
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
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <tool-button
        size="40"
        icon="mdi-brush"
        name="Paint"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click.stop="toggle"
      >
        <v-icon v-if="active" class="menu-more" size="18">
          mdi-menu-right
        </v-icon>
        <template #menu>
          <paint-controls />
        </template>
      </tool-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <tool-button
        size="40"
        icon="mdi-vector-square"
        name="Rectangle"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <tool-button
        size="40"
        icon="mdi-ruler"
        name="Ruler"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <tool-button
        size="40"
        icon="mdi-crop"
        name="Crop"
        :tooltip="{ location: 'bottom', transition: 'slide-y-transition' }"
        :button="{ class: ['tool-btn', active ? 'tool-btn-selected' : ''] }"
        :disabled="noCurrentImage"
        @click.stop="toggle"
      >
        <v-icon v-if="active" class="menu-more" size="18">
          mdi-menu-right
        </v-icon>
        <template #menu>
          <crop-controls />
        </template>
      </tool-button>
    </groupable-item>
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';
import { Tools } from '@/src/store/tools/types';
import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';
import { useDatasetStore } from '../store/datasets';
import { useToolStore } from '../store/tools';
import PaintControls from './PaintControls.vue';
import CropControls from './tools/crop/CropControls.vue';

export default defineComponent({
  components: {
    ToolButton,
    ItemGroup,
    GroupableItem,
    PaintControls,
    CropControls,
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
  background-color: rgb(var(--v-theme-selection-bg-color));
}
</style>

<style scoped>
.menu-more {
  position: absolute;
  right: -12%;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}
</style>
