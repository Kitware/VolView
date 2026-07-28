<template>
  <div class="file-widget">
    <div v-if="bindingMessage" class="text-caption text-error">
      {{ bindingMessage }}
    </div>
    <template v-else>
      <div class="bound-name text-body-2">
        <v-icon size="16" class="mr-2">{{ kind.icon }}</v-icon>
        {{ boundName ?? kind.caption }}
      </div>
      <div class="text-caption text-medium-emphasis bound-caption">
        {{ kind.caption }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VolViewTaskParameter, InputValue } from '@/backend-contract';
import { TYPE_TAG_ANNOTATIONS, TYPE_TAG_LABELMAP } from '@/backend-contract';
import {
  bindingStateMessage,
  type SourceRefBindingState,
  type SourceRefNoun,
} from '@/src/processing/engine/mintInput';
import type { BoundSourceRefType } from '@/src/processing/engine/sourceRefs';

const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: InputValue | null | undefined;
  binding?: SourceRefBindingState;
  boundName?: string;
  boundType?: BoundSourceRefType;
}>();

// How each bound kind names itself: the icon, the caption under the bound name,
// and the noun the binding sentences use.
const KINDS: Record<
  string,
  { icon: string; caption: string; noun: SourceRefNoun }
> = {
  [TYPE_TAG_LABELMAP]: {
    icon: 'mdi-brush-outline',
    caption: 'Active segment group',
    noun: 'segment group',
  },
  [TYPE_TAG_ANNOTATIONS]: {
    icon: 'mdi-ruler',
    caption: 'Annotations on the active dataset',
    noun: 'annotation',
  },
};

const IMAGE_KIND = {
  icon: 'mdi-image-outline',
  caption: 'Active dataset',
  noun: 'image' as SourceRefNoun,
};

// Before the binder has run, a param accepting exactly one type already names
// its kind.
const kind = computed(() => {
  const declared =
    props.param.kind === 'sourceRef' && props.param.accepts.length === 1
      ? props.param.accepts[0]
      : undefined;
  const type = props.boundType ?? declared;
  return (type ? KINDS[type] : undefined) ?? IMAGE_KIND;
});

const bindingMessage = computed(() =>
  props.binding
    ? bindingStateMessage(props.binding, kind.value.noun)
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
