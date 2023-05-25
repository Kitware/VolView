<script lang="ts">
import { watch, ref, computed, defineComponent, PropType } from 'vue';
import { useDisplay } from 'vuetify/lib/framework.mjs';
import { Labels, SetActiveLabel } from '@/src/store/tools/useLabels';
import ToolButton from './ToolButton.vue';
import LabelMenu from './LabelMenu.vue';

export default defineComponent({
  name: 'LabelToolButton',
  props: {
    icon: { type: String, required: true },
    name: { type: String, required: true },
    labels: { type: Object as PropType<Labels>, required: true },
    setActiveLabel: {
      type: Function as PropType<SetActiveLabel>,
      required: true,
    },
    activeLabel: { type: String, required: true },
    size: { type: [Number, String], default: 40 },
    buttonClass: [String, Array, Object],
    active: Boolean,
    disabled: Boolean,
  },
  components: {
    ToolButton,
    LabelMenu,
  },
  setup(props) {
    const display = useDisplay();
    const showLeft = computed(() => !display.mobile.value);
    // Turn off menu if tool deselected
    const menuOn = ref(false);
    const active = computed(() => props.active);
    watch(active, (on) => {
      if (!on) {
        menuOn.value = false;
      }
    });

    return { showLeft, menuOn };
  },
});
</script>

<template>
  <v-menu
    v-model="menuOn"
    :close-on-content-click="false"
    :close-on-click="false"
    :location="showLeft ? 'left' : 'right'"
  >
    <template v-slot:activator="{ props }">
      <!-- div needed for popup menu positioning -->
      <div>
        <tool-button
          :icon="icon"
          :name="name"
          :buttonClass="['tool-btn', active ? 'tool-btn-selected' : '']"
          :disabled="disabled"
          :size="size"
          @click="$emit('click')"
          v-bind="props"
        >
          <v-icon
            v-if="active"
            :class="[showLeft ? 'menu-more-left' : 'menu-more-right']"
            size="18"
          >
            {{ showLeft ? 'mdi-menu-left' : 'mdi-menu-right' }}
          </v-icon>
        </tool-button>
      </div>
    </template>

    <LabelMenu
      class="menu-content"
      :labels="labels"
      :setActiveLabel="setActiveLabel"
      :active-label="activeLabel"
    />
  </v-menu>
</template>

<style scoped>
.menu-more-left {
  position: absolute;
  left: -12%;
}
.menu-more-right {
  position: absolute;
  right: -12%;
}

.menu-content {
  /* Show on top of button tooltip */
  z-index: 1;
}
</style>
