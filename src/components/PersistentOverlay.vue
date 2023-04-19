<script setup>
import { toRefs, computed } from 'vue';

/**
 * This differs from v-overlay:
 * - smaller API
 * - does not hide unless disabled
 * - requires parent el to have position != static
 * - uses CSS theme vars
 */

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  /**
   * Must be a vuetify color
   */
  color: {
    type: String,
    default: '',
  },
  opacity: {
    type: Number,
    default: 0.2,
  },
  zIndex: {
    type: Number,
    default: 10,
  },
});

const { disabled, color, opacity, zIndex } = toRefs(props);

const colorAsStyle = computed(() =>
  color.value && color.value.startsWith('#') ? color.value : ''
);
const colorAsClass = computed(() =>
  color.value && !colorAsStyle.value ? `bg-${color.value}` : ''
);

const scrimClasses = computed(() => {
  const classes = {
    'persistent-overlay-scrim': true,
    'persistent-overlay-scrim-themed': color.value.length === 0,
  };
  if (colorAsClass.value) {
    classes[colorAsClass.value] = true;
  }
  return classes;
});

const scrimStyles = computed(() => {
  const styles = {
    opacity: opacity.value,
  };
  if (colorAsStyle.value) {
    styles['background-color'] = colorAsStyle.value;
  }
  return styles;
});

const containerStyles = computed(() => {
  const styles = {
    zIndex: zIndex.value,
  };
  return styles;
});
</script>

<template>
  <div v-if="!disabled" class="persistent-overlay" :style="containerStyles">
    <div :class="scrimClasses" :style="scrimStyles" />
    <slot />
  </div>
</template>

<style scoped>
.persistent-overlay {
  position: absolute;
  top: 0;
  height: 100%;
  width: 100%;
}

.persistent-overlay-scrim {
  position: absolute;
  top: 0;
  height: 100%;
  width: 100%;
  z-index: -100;
}

.persistent-overlay-scrim-themed {
  background-color: rgb(var(--v-theme-background));
}
</style>
