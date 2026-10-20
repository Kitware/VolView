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
      <ReasonedAction :reason="toolUnavailableReason(Tools.WindowLevel)">
        <menu-control-button
          icon="mdi-circle-half-full"
          :name="`Window & Level [${nameToShortcut['Window & Level']}]`"
          :active="active"
          :disabled="!!toolUnavailableReason(Tools.WindowLevel)"
          @click="toggle"
        >
          <window-level-controls />
        </menu-control-button>
      </ReasonedAction>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Pan">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Pan)">
        <control-button
          icon="mdi-cursor-move"
          :name="`Pan [${nameToShortcut['Pan']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Pan)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Zoom">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Zoom)">
        <control-button
          icon="mdi-magnify-plus-outline"
          :name="`Zoom [${nameToShortcut['Zoom']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Zoom)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Crosshairs"
    >
      <ReasonedAction :reason="toolUnavailableReason(Tools.Crosshairs)">
        <control-button
          icon="mdi-crosshairs"
          :name="`Crosshairs [${nameToShortcut['Crosshairs']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Crosshairs)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Select">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Select)">
        <control-button
          icon="mdi-cursor-default"
          :name="`Select [${nameToShortcut['Select']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Select)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Paint">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Paint)">
        <control-button
          icon="mdi-brush"
          :name="`Paint [${nameToShortcut['Paint']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Paint)"
          @click="toggle"
        ></control-button>
      </ReasonedAction>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <ReasonedAction :reason="toolUnavailableReason(Tools.Rectangle)">
        <control-button
          icon="mdi-vector-square"
          :name="`Rectangle [${nameToShortcut['Rectangle']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Rectangle)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Polygon)">
        <control-button
          icon="mdi-pentagon-outline"
          :name="`Polygon [${nameToShortcut['Polygon']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Polygon)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Ruler)">
        <control-button
          icon="mdi-ruler"
          :name="`Ruler [${nameToShortcut['Ruler']}]`"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="!!toolUnavailableReason(Tools.Ruler)"
          @click="toggle"
        />
      </ReasonedAction>
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <ReasonedAction :reason="toolUnavailableReason(Tools.Crop)">
        <menu-control-button
          icon="mdi-crop"
          :name="`Crop [${nameToShortcut['Crop']}]`"
          :active="active"
          :disabled="!!toolUnavailableReason(Tools.Crop)"
          @click="toggle"
        >
          <crop-controls />
        </menu-control-button>
      </ReasonedAction>
    </groupable-item>
    <div class="my-1 tool-separator" />
    <reset-views />
  </item-group>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';
import { onKeyDown } from '@vueuse/core';
import { Tools } from '@/src/store/tools/types';
import ControlButton from '@/src/components/ControlButton.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useToolStore, getToolUnavailableReason } from '@/src/store/tools';
import { useEffectiveView } from '@/src/composables/useEffectiveView';
import { toRef } from 'vue';
import MenuControlButton from '@/src/components/MenuControlButton.vue';
import CropControls from '@/src/components/tools/crop/CropControls.vue';
import ResetViews from '@/src/components/tools/ResetViews.vue';
import WindowLevelControls from '@/src/components/tools/windowing/WindowLevelControls.vue';
import {
  actionToKey,
  readableBinding,
  useActionHeld,
} from '@/src/composables/useKeyboardShortcuts';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useViewStore } from '@/src/store/views';

export default defineComponent({
  components: {
    ControlButton,
    ReasonedAction,
    MenuControlButton,
    ItemGroup,
    GroupableItem,
    CropControls,
    ResetViews,
    WindowLevelControls,
  },
  setup() {
    const toolStore = useToolStore();
    const viewStore = useViewStore();

    const { currentImageID } = useCurrentImage();
    const noCurrentImage = computed(() => !currentImageID.value);
    const currentTool = computed(() => toolStore.currentTool);

    const activeViewRef = toRef(viewStore, 'activeView');
    const activeEffective = useEffectiveView(
      computed(() => activeViewRef.value ?? '')
    );
    // The rendered viewer is decided by effective kind, not stored slot type:
    // a cine clip dropped into an Oblique slot still renders as cine, so the
    // toolbar should treat it as cine, not Oblique.
    const isObliqueLayout = computed(
      () => activeEffective.value?.kind === 'oblique'
    );
    const obliqueUnavailableTools = new Set([
      Tools.Crosshairs,
      Tools.Paint,
      Tools.Rectangle,
      Tools.Polygon,
      Tools.Ruler,
      Tools.Crop,
    ]);
    const toolUnavailableReason = (tool: Tools) => {
      const effective = activeEffective.value;
      const sharedReason = getToolUnavailableReason(tool, effective);
      if (sharedReason) return sharedReason;
      if (noCurrentImage.value) return 'Load an image to use this tool.';
      if (isObliqueLayout.value && obliqueUnavailableTools.has(tool))
        return 'This tool is unavailable in an oblique view.';
      return tool === Tools.Paint
        ? toolStore.paintUnavailableReason || undefined
        : undefined;
    };
    const paintMenu = ref(false);
    const cropMenu = ref(false);
    const windowingMenu = ref(false);

    onKeyDown('Escape', () => {
      paintMenu.value = false;
      cropMenu.value = false;
      windowingMenu.value = false;
    });

    const enableTempCrosshairs = useActionHeld('temporaryCrosshairs');
    watch(enableTempCrosshairs, (enable) => {
      if (enable) toolStore.activateTemporaryCrosshairs();
      else toolStore.deactivateTemporaryCrosshairs();
    });

    // Rename the computed property to map tool names to their keyboard shortcuts
    const nameToShortcut = computed(() => {
      const keyMap = actionToKey.value;
      return {
        'Window & Level': readableBinding(keyMap.windowLevel),
        Pan: readableBinding(keyMap.pan),
        Zoom: readableBinding(keyMap.zoom),
        Crosshairs: readableBinding(keyMap.crosshairs),
        Select: readableBinding(keyMap.select),
        Paint: readableBinding(keyMap.paint),
        Rectangle: readableBinding(keyMap.rectangle),
        Polygon: readableBinding(keyMap.polygon),
        Ruler: readableBinding(keyMap.ruler),
        Crop: readableBinding(keyMap.crop),
      };
    });

    return {
      currentTool,
      setCurrentTool: toolStore.setCurrentTool,
      noCurrentImage,
      isObliqueLayout,
      toolUnavailableReason,
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
  background-color: rgb(var(--v-theme-primary-darken-1));
  color: rgb(var(--v-theme-on-primary-darken-1));
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
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.3);
}

.popup-menu {
  max-width: 400px; /* a little less than v-navigation-drawer in App.vue */
}
</style>
