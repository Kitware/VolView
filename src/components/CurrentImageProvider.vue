<script setup lang="ts">
import { Maybe } from '@/src/types';
import { provide, toRefs } from 'vue';
import { CurrentImageInjectionKey } from '@/src/composables/useCurrentImage';

const props = defineProps<{
  imageId: Maybe<string>;
}>();

const { imageId: imageID } = toRefs(props);

provide(CurrentImageInjectionKey, {
  imageID,
});
</script>

<template>
  <slot />
</template>
