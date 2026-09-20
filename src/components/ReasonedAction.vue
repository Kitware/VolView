<script setup lang="ts">
// Disabled controls get no hover or focus; this holds the tooltip and tab stop.
withDefaults(
  defineProps<{
    reason?: string;
    tooltip?: string;
    location?: 'top' | 'end';
    block?: boolean;
  }>(),
  { location: 'top' }
);
</script>

<template>
  <component
    :is="block ? 'div' : 'span'"
    :class="{ 'd-inline-flex': !block }"
    :tabindex="reason ? 0 : undefined"
  >
    <slot :disabled="!!reason"></slot>
    <v-tooltip
      v-if="reason || tooltip"
      :location="location"
      activator="parent"
      >{{ reason || tooltip }}</v-tooltip
    >
  </component>
</template>
