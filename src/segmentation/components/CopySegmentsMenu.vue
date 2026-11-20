<script setup lang="ts">
import { computed } from 'vue';

import ListActionRow from '@/src/components/ListActionRow.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { Maybe } from '@/src/types';

const props = defineProps<{ imageId: Maybe<string> }>();

const registry = useSegmentStore().segments;
const imageCacheStore = useImageCacheStore();

// The name index is not reactive, so names come from the reactive list.
const targetNames = computed(
  () => new Set(registry.segmentList(props.imageId).map(({ name }) => name))
);

const sources = computed(() =>
  imageCacheStore.imageIds
    .filter((id) => id !== props.imageId)
    .map((id) => ({ id, segments: registry.segmentList(id) }))
    .filter(({ segments }) => segments.length > 0)
    .map(({ id, segments }) => ({
      id,
      name: imageCacheStore.getImageMetadata(id)?.name ?? id,
      count: `${segments.length} ${segments.length === 1 ? 'segment' : 'segments'}`,
      reason: segments.every(({ name }) => targetNames.value.has(name))
        ? 'Every segment is already on this image'
        : '',
    }))
);

const reason = computed(() => {
  if (!props.imageId) return 'Select an image to edit segments';
  return sources.value.length ? '' : 'No other image has segments yet';
});

const copyFrom = (sourceId: string) => {
  if (props.imageId) registry.copySegments(props.imageId, sourceId);
};
</script>

<template>
  <v-menu location="bottom">
    <template #activator="{ props: menu }">
      <list-action-row
        v-bind="menu"
        class="copy-segments-row"
        icon="mdi-content-copy"
        text="Copy segments from..."
        :reason="reason"
      />
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
