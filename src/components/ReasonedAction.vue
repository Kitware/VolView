<script setup lang="ts">
import { onMounted, onUpdated, shallowRef, useTemplateRef } from 'vue';

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

// Focus does not bubble, so an enabled control must be the activator itself.
const wrapper = useTemplateRef<HTMLElement>('wrapper');
const control = shallowRef<Element>();
const findControl = () => {
  control.value = wrapper.value?.firstElementChild ?? undefined;
};
onMounted(findControl);
onUpdated(findControl);
</script>

<template>
  <component
    :is="block ? 'div' : 'span'"
    ref="wrapper"
    :class="{ 'd-inline-flex': !block }"
    :tabindex="reason ? 0 : undefined"
  >
    <slot :disabled="!!reason"></slot>
    <v-tooltip
      v-if="reason || tooltip"
      :location="location"
      :activator="reason || !control ? 'parent' : control"
      >{{ reason || tooltip }}</v-tooltip
    >
  </component>
</template>
