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
      <menu-control-button
        icon="mdi-circle-half-full"
        :name="`Window & Level [${nameToShortcut['Window & Level']}]`"
        :active="active"
        :disabled="noCurrentImage"
        @click="toggle"
      >
        <window-level-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <control-button
        icon="mdi-cursor-move"
        :name="`Pan [${nameToShortcut['Pan']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <control-button
        icon="mdi-magnify-plus-outline"
        :name="`Zoom [${nameToShortcut['Zoom']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Crosshairs"
    >
      <control-button
        icon="mdi-crosshairs"
        :name="`Crosshairs [${nameToShortcut['Crosshairs']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Select">
      <control-button
        icon="mdi-cursor-default"
        :name="`Select [${nameToShortcut['Select']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <control-button
        icon="mdi-brush"
        :name="`Paint [${nameToShortcut['Paint']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      ></control-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <menu-control-button
        icon="mdi-vector-square"
        :name="`Rectangle [${nameToShortcut['Rectangle']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <rectangle-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <menu-control-button
        icon="mdi-pentagon-outline"
        :name="`Polygon [${nameToShortcut['Polygon']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <polygon-controls />
      </menu-control-button>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <menu-control-button
        icon="mdi-ruler"
        :name="`Ruler [${nameToShortcut['Ruler']}]`"
        :mobileOnlyMenu="true"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <ruler-controls />
      </menu-control-button>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <menu-control-button
        icon="mdi-crop"
        :name="`Crop [${nameToShortcut['Crop']}]`"
        :active="active"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      >
        <crop-controls />
      </menu-control-button>
    </groupable-item>
    <div class="my-1 tool-separator" />
    <reset-views />
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { onKeyDown, useMagicKeys } from '@vueuse/core';
import { Tools } from '@/src/store/tools/types';
import ControlButton from '@/src/components/ControlButton.vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useDatasetStore } from '@/src/store/datasets';
import { useToolStore } from '@/src/store/tools';
import { useViewStore } from '@/src/store/views';
import MenuControlButton from '@/src/components/MenuControlButton.vue';
import CropControls from '@/src/components/tools/crop/CropControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import RulerControls from '@/src/components/RulerControls.vue';
import RectangleControls from '@/src/components/RectangleControls.vue';
import PolygonControls from '@/src/components/PolygonControls.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';

export default defineComponent({
  components: {
    ControlButton,
    MenuControlButton,
    ItemGroup,
    GroupableItem,
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

    const keys = useMagicKeys();
    const enableTempCrosshairs = computed(
      () => keys[actionToKey.value.temporaryCrosshairs].value
    );
    watch(enableTempCrosshairs, (enable) => {
      if (enable) toolStore.activateTemporaryCrosshairs();
      else toolStore.deactivateTemporaryCrosshairs();
    });

    // Rename the computed property to map tool names to their keyboard shortcuts
    const nameToShortcut = computed(() => {
      const keyMap = actionToKey.value;
      return {
        'Window & Level': keyMap.windowLevel,
        Pan: keyMap.pan,
        Zoom: keyMap.zoom,
        Crosshairs: keyMap.crosshairs,
        Select: keyMap.select,
        Paint: keyMap.paint,
        Rectangle: keyMap.rectangle,
        Polygon: keyMap.polygon,
        Ruler: keyMap.ruler,
        Crop: keyMap.crop,
      };
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
      nameToShortcut,
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
