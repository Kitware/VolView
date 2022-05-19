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
      <v-menu
        v-model="paintMenu"
        offset-x
        :close-on-content-click="false"
        :disabled="!active"
      >
        <template v-slot:activator="{ attrs, on }">
          <div>
            <tool-button
              size="40"
              icon="mdi-brush"
              name="Paint"
              :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
              :disabled="noCurrentImage"
              @click.stop="toggle"
              v-on="on"
              v-bind="attrs"
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
import { computed, defineComponent, ref } from '@vue/composition-api';
import { onKeyDown } from '@vueuse/core';
import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';
import { useDatasetStore } from '../store/datasets';
import { Tools, useToolStore } from '../store/tools';
import PaintControls from './PaintControls.vue';

export default defineComponent({
  components: {
    ToolButton,
    ItemGroup,
    GroupableItem,
    PaintControls,
  },
  setup() {
    const dataStore = useDatasetStore();
    const toolStore = useToolStore();

    const noCurrentImage = computed(() => !dataStore.primaryDataset);
    const currentTool = computed(() => toolStore.currentTool);

    const paintMenu = ref(false);
    onKeyDown('Escape', () => {
      paintMenu.value = false;
    });

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      Tools,
      paintMenu,
    };
  },
});
</script>

<style>
.tool-btn-selected {
  background-color: rgba(128, 128, 255, 0.7);
}
</style>

<style scoped>
.menu-more {
  position: absolute;
  right: -50%;
}
</style>
