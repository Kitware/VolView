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
        icon="mdi-circle-half-full"
        name="Window & Level"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <tool-button
        icon="mdi-cursor-move"
        name="Pan"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <tool-button
        icon="mdi-magnify-plus-outline"
        name="Zoom"
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
        icon="mdi-crosshairs"
        name="Crosshairs"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <MenuToolButton
        icon="mdi-brush"
        name="Paint"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <paint-controls />
      </MenuToolButton>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <MenuToolButton
        icon="mdi-vector-square"
        name="Rectangle"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <LabelMenu
          :labels="rectangleStore.labels"
          :set-active-label="rectangleStore.setActiveLabel"
          :active-label="rectangleStore.activeLabel"
        />
      </MenuToolButton>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <MenuToolButton
        icon="mdi-ruler"
        name="Ruler"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <LabelMenu
          :labels="rulerStore.labels"
          :set-active-label="rulerStore.setActiveLabel"
          :active-label="rulerStore.activeLabel"
        />
      </MenuToolButton>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <MenuToolButton
        icon="mdi-crop"
        name="Crop"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <crop-controls />
      </MenuToolButton>
    </groupable-item>
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { Tools } from '@/src/store/tools/types';
import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';
import { useDatasetStore } from '../store/datasets';
import { useToolStore } from '../store/tools';
import PaintControls from './PaintControls.vue';
import MenuToolButton from './MenuToolButton.vue';
import CropControls from './tools/crop/CropControls.vue';
import LabelMenu from './LabelMenu.vue';
import { useRectangleStore } from '../store/tools/rectangles';
import { useRulerStore } from '../store/tools/rulers';

export default defineComponent({
  components: {
    ToolButton,
    MenuToolButton,
    ItemGroup,
    GroupableItem,
    PaintControls,
    CropControls,
    LabelMenu,
  },
  setup() {
    const dataStore = useDatasetStore();
    const toolStore = useToolStore();

    const noCurrentImage = computed(() => !dataStore.primaryDataset);
    const currentTool = computed(() => toolStore.currentTool);

    const rectangleStore = useRectangleStore();
    const rulerStore = useRulerStore();

    const paintMenu = ref(false);
    const cropMenu = ref(false);

    onKeyDown('Escape', () => {
      paintMenu.value = false;
      cropMenu.value = false;
    });

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      Tools,
      paintMenu,
      cropMenu,
      rectangleStore,
      rulerStore,
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
  right: -10%;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}
</style>
