<template>
  <div class="file-widget">
    <div v-if="bindingMessage" class="text-caption text-error">
      {{ bindingMessage }}
    </div>
    <template v-else>
      <div class="bound-name text-body-2">
        <v-icon size="16" class="mr-2">
          {{ isLabelmap ? 'mdi-brush-outline' : 'mdi-image-outline' }}
        </v-icon>
        {{
          boundName ?? (isLabelmap ? 'Active segment group' : 'Active dataset')
        }}
      </div>
      <div class="text-caption text-medium-emphasis bound-caption">
        {{ isLabelmap ? 'Active segment group' : 'Active dataset' }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VolViewTaskParameter, InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import {
  bindingStateMessage,
  type SourceRefBindingState,
} from '@/src/processing/engine/mintInput';
import type { BoundSourceRefType } from '@/src/processing/engine/sourceRefs';

const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: InputValue | null | undefined;
  binding?: SourceRefBindingState;
  boundName?: string;
  boundType?: BoundSourceRefType;
}>();

const isLabelmap = computed(
  () =>
    props.boundType === TYPE_TAG_LABELMAP ||
    (props.boundType == null &&
      props.param.kind === 'sourceRef' &&
      props.param.accepts.length === 1 &&
      props.param.accepts.includes(TYPE_TAG_LABELMAP))
);

const bindingMessage = computed(() =>
  props.binding
    ? bindingStateMessage(
        props.binding,
        isLabelmap.value ? 'segment group' : 'image'
      )
    : undefined
);
</script>

<style scoped>
.file-widget {
  padding: 2px 0;
}
.bound-name {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bound-caption {
  margin-left: 24px;
}
</style>
