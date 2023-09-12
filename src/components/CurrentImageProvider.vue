<script setup lang="ts">
import { Maybe } from '@/src/types';
import { computed, provide, toRefs } from 'vue';
import {
  CurrentImageInjectionKey,
  getImageMetadata,
  getImageData,
  getImageLayers,
  getImageSpatialExtent,
  getIsImageLoading,
} from '@/src/composables/useCurrentImage';

const props = defineProps<{
  imageId: Maybe<string>;
}>();

const { imageId } = toRefs(props);

provide(CurrentImageInjectionKey, {
  id: imageId,
  metadata: computed(() => getImageMetadata(imageId.value)),
  imageData: computed(() => getImageData(imageId.value)),
  extent: computed(() => getImageSpatialExtent(imageId.value)),
  isLoading: computed(() => getIsImageLoading(imageId.value)),
  layers: computed(() => getImageLayers(imageId.value)),
});
</script>

<template>
  <slot />
</template>
