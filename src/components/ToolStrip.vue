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
      <menu-tool-button
        icon="mdi-circle-half-full"
        name="Window & Level"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <window-level-controls />
      </menu-tool-button>
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
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Select">
      <tool-button
        icon="mdi-cursor-default"
        name="Select"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <menu-tool-button
        icon="mdi-brush"
        name="Paint"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <paint-controls />
      </menu-tool-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <menu-tool-button
        icon="mdi-vector-square"
        name="Rectangle"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <rectangle-controls />
      </menu-tool-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <menu-tool-button
        icon="mdi-pentagon-outline"
        name="Polygon"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <polygon-controls />
      </menu-tool-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <menu-tool-button
        icon="mdi-ruler"
        name="Ruler"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <ruler-controls />
      </menu-tool-button>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <menu-tool-button
        icon="mdi-crop"
        name="Crop"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <crop-controls />
      </menu-tool-button>
    </groupable-item>
    <div class="my-1 tool-separator" />
    <reset-views />
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { onKeyDown } from '@vueuse/core';
import { Tools } from '@/src/store/tools/types';
import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';
import { useDatasetStore } from '../store/datasets';
import { useToolStore } from '../store/tools';
import { useViewStore } from '../store/views';
import PaintControls from './PaintControls.vue';
import MenuToolButton from './MenuToolButton.vue';
import CropControls from './tools/crop/CropControls.vue';
import ResetViews from './tools/ResetViews.vue';
import RulerControls from './RulerControls.vue';
import RectangleControls from './RectangleControls.vue';
import PolygonControls from './PolygonControls.vue';
import WindowLevelControls from './tools/windowing/WindowLevelControls.vue';

export default defineComponent({
  components: {
    ToolButton,
    MenuToolButton,
    ItemGroup,
    GroupableItem,
    PaintControls,
    CropControls,
    ResetViews,
    RulerControls,
    RectangleControls,
    PolygonControls,
    WindowLevelControls,
  },
  setup() {
    const dataStore = useDatasetStore();
    const toolStore = useToolStore();
    const viewStore = useViewStore();

    const noCurrentImage = computed(() => !dataStore.primaryDataset);
    const currentTool = computed(() => toolStore.currentTool);
    const { layout: currentLayout } = storeToRefs(viewStore);
    const isObliqueLayout = computed(
      () => currentLayout.value?.name === 'Oblique View'
    );

    const paintMenu = ref(false);
    const cropMenu = ref(false);
    const windowingMenu = ref(false);

    onKeyDown('Escape', () => {
      paintMenu.value = false;
      cropMenu.value = false;
      windowingMenu.value = false;
    });

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      isObliqueLayout,
      Tools,
      paintMenu,
      cropMenu,
      windowingMenu,
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

.popup-menu {
  max-width: 400px; /* a little less than v-navigation-drawer in App.vue */
}
</style>
