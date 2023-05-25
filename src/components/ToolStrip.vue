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
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <tool-button
        size="40"
        icon="mdi-cursor-move"
        name="Pan"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <tool-button
        size="40"
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
        size="40"
        icon="mdi-crosshairs"
        name="Crosshairs"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <v-menu
        v-model="paintMenu"
        location="end"
        :close-on-content-click="false"
        :disabled="!active"
      >
        <template v-slot:activator="{ props }">
          <div>
            <tool-button
              size="40"
              icon="mdi-brush"
              name="Paint"
              :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
              :disabled="noCurrentImage"
              @click.stop="toggle"
              v-bind="props"
            >
              <v-icon v-if="active" class="menu-more" size="18">
                mdi-menu-right
              </v-icon>
            </tool-button>
          </div>
        </template>
        <paint-controls />
      </v-menu>
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
        size="40"
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
        size="40"
        @click="toggle"
      >
        <LabelMenu
          :labels="rectangleStore.labels"
          :set-active-label="rectangleStore.setActiveLabel"
          :active-label="rectangleStore.activeLabel"
        />
      </MenuToolButton>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <v-menu
        v-model="cropMenu"
        location="end"
        open-on-hover
        close-on-content-click
      >
        <template v-slot:activator="{ props }">
          <div>
            <tool-button
              size="40"
              icon="mdi-crop"
              name="Crop"
              tooltipLocation="bottom"
              :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
              :disabled="noCurrentImage"
              @click.stop="toggle"
              v-bind="props"
            >
              <v-icon v-if="active" class="menu-more" size="18">
                mdi-menu-right
              </v-icon>
            </tool-button>
          </div>
        </template>
        <crop-controls />
      </v-menu>
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
