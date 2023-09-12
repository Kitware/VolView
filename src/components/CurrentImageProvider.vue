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
import { useDatasetStore } from '@/src/store/datasets';
import { useDICOMStore } from '@/src/store/datasets-dicom';

const props = defineProps<{
  imageId?: Maybe<string>;
}>();

const { imageId: imageIdProp } = toRefs(props);

const imageId = computed(() => {
  if (props.imageId) return imageIdProp?.value;

  const { primarySelection } = useDatasetStore();
  if (primarySelection?.type === 'image') {
    return primarySelection.dataID;
  }

  if (primarySelection?.type === 'dicom') {
    const { volumeToImageID } = useDICOMStore();
    return volumeToImageID[primarySelection.volumeKey] || null;
  }

  return null;
});

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
