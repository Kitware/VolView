<script setup lang="ts">
import { computed } from 'vue';

import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe } from '@/src/types';
import { plural } from '@/src/utils';

const props = defineProps<{
  imageId: Maybe<string>;
  unavailableReason: string;
}>();

const registry = useSegmentStore().segments;
const imageCacheStore = useImageCacheStore();

const sources = computed(() =>
  imageCacheStore.imageIds
    .filter((id) => id !== props.imageId)
    .map((id) => ({ id, segments: registry.segmentList(id) }))
    .filter(({ segments }) => segments.length > 0)
    .map(({ id, segments }) => ({
      id,
      name: imageCacheStore.getImageMetadata(id)?.name ?? id,
      count: `${segments.length} ${plural(segments.length, 'segment')}`,
      reason: registry.missingFrom(props.imageId, id).length
        ? ''
        : 'Every segment is already on this image',
    }))
);

const reason = computed(
  () =>
    props.unavailableReason ||
    (sources.value.length ? '' : 'No other image has segments yet')
);

const copyFrom = (sourceId: string) => {
  if (props.imageId) registry.copySegments(props.imageId, sourceId);
};
</script>

<template>
  <v-menu location="bottom">
    <template #activator="{ props: menu }">
      <reasoned-action :reason="reason" v-slot="{ disabled }">
        <v-btn
          v-bind="menu"
          class="copy-segments-row text-none"
          variant="tonal"
          size="small"
          prepend-icon="mdi-content-copy"
          :disabled="disabled"
        >
          Copy segments from...
        </v-btn>
      </reasoned-action>
    </template>
    <v-list density="compact">
      <reasoned-action
        v-for="source in sources"
        :key="source.id"
        block
        location="end"
        :reason="source.reason"
        v-slot="{ disabled }"
      >
        <v-list-item
          :disabled="disabled"
          :title="source.name"
          :subtitle="source.count"
          @click="copyFrom(source.id)"
        />
      </reasoned-action>
    </v-list>
  </v-menu>
</template>
