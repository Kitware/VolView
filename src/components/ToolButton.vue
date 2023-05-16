<template>
  <v-menu
    location="end"
    :close-on-content-click="false"
    :disabled="!!$slots.menu"
    v-bind="menu"
  >
    <template #activator="{ props: menuProps }">
      <v-tooltip
        location="right"
        transition="slide-x-transition"
        v-bind="tooltip"
      >
        <template #activator="{ props: tooltipProps }">
          <v-btn
            variant="text"
            :rounded="0"
            dark
            :height="sizeV"
            :width="sizeV"
            :min-width="sizeV"
            :max-width="sizeV"
            v-bind="mergeProps(menuProps, tooltipProps, button, $attrs)"
          >
            <v-icon :size="iconSize">{{ icon }}</v-icon>
            <slot />
          </v-btn>
        </template>
        <span>{{ name }}</span>
      </v-tooltip>
    </template>
    <slot name="menu" />
  </v-menu>
</template>

<script>
import { mergeProps } from 'vue';

export default {
  name: 'ToolButton',
  props: {
    icon: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: [Number, String], default: 40 },
    button: { type: Object, default: () => ({}) },
    tooltip: { type: Object, default: () => ({}) },
    menu: { type: Object, default: () => ({}) },
  },

  computed: {
    sizeV() {
      return Number(this.size);
    },
    iconSize() {
      return Math.floor(0.6 * this.sizeV);
    },
  },

  methods: {
    mergeProps,
  },
};
</script>
