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
      <v-tooltip
        :text="windowingUnavailableReason"
        :disabled="!windowingUnavailableReason"
        location="right"
      >
        <template #activator="{ props: tooltipProps }">
          <span
            v-bind="tooltipProps"
            :tabindex="windowingUnavailableReason ? 0 : undefined"
            data-testid="windowing-tool"
          >
            <menu-control-button
              icon="mdi-circle-half-full"
              :name="`Window & Level [${nameToShortcut['Window & Level']}]`"
              :active="active"
              :disabled="!!windowingUnavailableReason"
              @click="toggle"
            >
              <window-level-controls />
            </menu-control-button>
          </span>
        </template>
      </v-tooltip>
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
        :disabled="
          noCurrentImage ||
          isObliqueLayout ||
          isDisallowedOnCine(Tools.Crosshairs)
        "
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
        :disabled="!!paintUnavailableReason"
        @click="toggle"
      ></control-button>
    </groupable-item>
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.Rectangle"
    >
      <control-button
        icon="mdi-vector-square"
        :name="`Rectangle [${nameToShortcut['Rectangle']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Polygon">
      <control-button
        icon="mdi-pentagon-outline"
        :name="`Polygon [${nameToShortcut['Polygon']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <control-button
        icon="mdi-ruler"
        :name="`Ruler [${nameToShortcut['Ruler']}]`"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noCurrentImage || isObliqueLayout"
        @click="toggle"
      />
    </groupable-item>

    <div class="my-1 tool-separator" />
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Crop">
      <menu-control-button
        icon="mdi-crop"
        :name="`Crop [${nameToShortcut['Crop']}]`"
        :active="active"
        :disabled="
          noCurrentImage || isObliqueLayout || isDisallowedOnCine(Tools.Crop)
        "
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
import { computed, defineComponent, watch } from 'vue';
import { Tools } from '@/src/store/tools/types';
import ControlButton from '@/src/components/ControlButton.vue';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import { useToolStore, isToolAllowedFor } from '@/src/store/tools';
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
import { isCineImage } from '@/src/core/cine/isCineImage';

export default defineComponent({
  components: {
    ControlButton,
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

    const { currentImageID, currentImageData } = useCurrentImage();
    const noCurrentImage = computed(() => !currentImageID.value);
    const currentTool = computed(() => toolStore.currentTool);

    const windowingUnavailableReason = computed(() => {
      if (!currentImageID.value) return 'Load an image to adjust window/level.';
      const scalars = currentImageData.value?.getPointData().getScalars();
      if (!scalars) return 'The image must finish loading first.';
      if (isCineImage(currentImageID.value))
        return 'Cine images already contain display-encoded pixels.';
      const components = scalars.getNumberOfComponents();
      if (components === 3 || components === 4)
        return 'RGB and RGBA images use their original colors.';
      return '';
    });

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

    const isCineActive = computed(() => activeEffective.value?.kind === 'cine');
    const isDisallowedOnCine = (tool: Tools) =>
      isCineActive.value && !isToolAllowedFor(tool, activeEffective.value);

    const paintUnavailableReason = computed(
      () => toolStore.paintUnavailableReason
    );

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
      windowingUnavailableReason,
      isObliqueLayout,
      isDisallowedOnCine,
      paintUnavailableReason,
      Tools,
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
.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.3);
}
</style>
