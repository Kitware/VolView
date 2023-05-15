<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useDisplay } from 'vuetify/lib/framework.mjs';
import ToolButton from './ToolButton.vue';

export default defineComponent({
  name: 'LabelToolButton',
  props: {
    icon: { type: String, required: true },
    name: { type: String, required: true },
    labelControls: { type: Object, required: true },
    activeLabel: { type: String, required: true },
    size: { type: [Number, String], default: 40 },
    buttonClass: [String, Array, Object],
    active: Boolean,
    disabled: Boolean,
  },
  components: {
    ToolButton,
  },
  setup() {
    const display = useDisplay();
    const showLeft = computed(() => !display.mobile);
    return { showLeft };
  },
});
</script>

<template>
  <v-menu
    offset-x
    :left="showLeft"
    :right="!showLeft"
    :close-on-content-click="false"
    :close-on-click="false"
    :disabled="!active"
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
            :class="[
              'tool-separator',
              showLeft ? 'menu-more-left' : 'menu-more-right',
            ]"
            size="18"
          >
            {{ showLeft ? 'mdi-menu-left' : 'mdi-menu-right' }}
          </v-icon>
        </tool-button>
      </div>
    </template>

    <v-card>
      <v-card-text>
        <v-radio-group
          :value="activeLabel"
          v-on:change="labelControls.setActiveLabel"
          class="mt-0"
          hide-details
        >
          <v-radio
            v-for="(color, name) in labelControls.labels"
            :key="name"
            :label="name"
            :value="name"
          >
            <template v-slot:label>
              <v-icon :color="color" size="18" class="pr-2">
                mdi-square
              </v-icon>
              {{ name }}
            </template>
          </v-radio>
        </v-radio-group>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.menu-more-left {
  position: absolute;
  left: -50%;
}
.menu-more-right {
  position: absolute;
  right: -50%;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgb(112, 112, 112);
}
</style>
