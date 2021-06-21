<template>
  <item-group mandatory v-model="currentTool">
    <groupable-item
      v-slot:default="{ active, toggle }"
      :value="Tools.WindowLevel"
    >
      <tool-button
        size="40"
        icon="mdi-circle-half-full"
        name="Window & Level"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noBaseImage"
        @click="toggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active }" :value="Tools.Paint">
      <tool-button
        size="40"
        icon="mdi-brush"
        name="Paint"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noBaseImage"
        @click="handlePaintToggle"
      />
    </groupable-item>
    <groupable-item v-slot:default="{ active, toggle }" :value="Tools.Ruler">
      <tool-button
        size="40"
        icon="mdi-ruler"
        name="Ruler"
        :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
        :disabled="noBaseImage"
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
        :disabled="noBaseImage"
        @click="toggle"
      />
    </groupable-item>
  </item-group>
</template>

<script>
import { defineComponent, ref, watch } from '@vue/composition-api';
import { useComputedState } from '@/src/composables/store';
import { useWidgetProvider } from '@/src/composables/widgetProvider';
import { NO_WIDGET, NO_SELECTION } from '@/src/constants';

import ToolButton from './ToolButton.vue';
import ItemGroup from './ItemGroup.vue';
import GroupableItem from './GroupableItem.vue';

const Tools = {
  WindowLevel: 'WindowLevel',
  Paint: 'Paint',
  Ruler: 'Ruler',
  Crosshairs: 'Crosshairs',
};

const WidgetSet = new Set([Tools.Paint, Tools.Ruler, Tools.Crosshairs]);

export default defineComponent({
  components: {
    ToolButton,
    ItemGroup,
    GroupableItem,
  },
  setup(props, { emit }) {
    const currentTool = ref(Tools.WindowLevel); // string: tool name
    const showPaintMenu = ref(false);

    const widgetProvider = useWidgetProvider();

    const { noBaseImage, focusedWidget } = useComputedState({
      noBaseImage: (state) => state.selectedBaseImage === NO_SELECTION,
      focusedWidget: (state) => state.widgets.focusedWidget,
    });

    // re-implementation of the groupable-item toggle slot function
    function toggle(name) {
      const current = currentTool.value;
      currentTool.value = current === name ? null : name;
      return currentTool.value === name;
    }

    function handlePaintToggle() {
      const active = currentTool.value === Tools.Paint;
      if (active) {
        showPaintMenu.value = true;
      } else if (toggle(Tools.Paint)) {
        emit('focusModule', 'Annotations');
      }
    }

    // handle case when widget unfocuses self while tool is active
    // in such event, create a new widget
    watch(focusedWidget, (widgetId) => {
      if (widgetId === NO_WIDGET && WidgetSet.has(currentTool.value)) {
        const widget = widgetProvider.createWidget(currentTool.value);
        widgetProvider.focusWidget(widget.id);
      }
    });

    watch(currentTool, (curTool) => {
      // unfocus existing widgets
      widgetProvider.unfocus();

      if (curTool === 'WindowLevel') {
        // do something
      } else if (WidgetSet.has(curTool)) {
        const widget = widgetProvider.createWidget(curTool);
        widgetProvider.focusWidget(widget.id);
      }
    });

    return {
      currentTool,
      showPaintMenu,
      noBaseImage,
      Tools,
      handlePaintToggle,
    };
  },
});
</script>

<style>
.tool-btn-selected {
  background-color: rgba(128, 128, 255, 0.7);
}
</style>
