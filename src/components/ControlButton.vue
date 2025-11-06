<template>
  <v-btn
    variant="text"
    :rounded="0"
    dark
    :height="sizeV"
    :width="sizeV"
    :min-width="sizeV"
    :max-width="sizeV"
    :class="classV"
    :data-testid="`control-button-${name}`"
    v-bind="$attrs"
  >
    <v-icon :size="iconSize">{{ icon }}</v-icon>
    <v-tooltip
      :location="tooltipLocation"
      activator="parent"
      transition="slide-x-transition"
    >
      <span>{{ name }}</span>
    </v-tooltip>
    <slot />
  </v-btn>
</template>

<script>
export default {
  name: 'ControlButton',
  props: {
    icon: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: [Number, String], default: 40 },
    buttonClass: [String, Array, Object],
    tooltipLocation: { type: String, default: 'right' },
  },

  computed: {
    sizeV() {
      return Number(this.size);
    },
    iconSize() {
      return Math.floor(0.6 * this.sizeV);
    },
    classV() {
      const classSpec = this.buttonClass;
      if (typeof classSpec === 'string') {
        return classSpec;
      }
      if (Array.isArray(classSpec)) {
        return classSpec.join(' ');
      }
      if (classSpec && Object.keys(classSpec).length) {
        return Object.keys(this.buttonClass)
          .filter((key) => this.buttonClass[key])
          .join(' ');
      }
      return '';
    },
  },
};
</script>
