<template>
  <div class="file-widget">
    <div class="input-key text-caption text-medium-emphasis">
      <v-icon size="16">{{ kind.icon }}</v-icon>
      <span class="key-text">
        {{ kind.caption }}{{ param.required ? '' : ' (optional)' }}
      </span>
    </div>
    <div
      class="input-value text-body-2"
      :class="{ 'text-error': bindingMessage }"
    >
      <span class="value-text">{{ bindingMessage ?? boundDisplayName }}</span>
    </div>
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

// How each bound kind names itself in the key column and the noun the binding
// sentences use. `pluralCaption` is how a parameter taking more than one value
// names itself; kinds without one do not bind plurally.
type KindVocabulary = {
  icon: string;
  caption: string;
  pluralCaption?: string;
  noun: SourceRefNoun;
};

const KINDS: Record<string, KindVocabulary> = {
  [TYPE_TAG_LABELMAP]: {
    icon: 'mdi-brush-outline',
    caption: 'Active segment group',
    pluralCaption: 'Segment groups on active dataset',
    noun: 'segment group',
  },
  [TYPE_TAG_ANNOTATIONS]: {
    icon: 'mdi-ruler',
    caption: 'Annotations',
    noun: 'annotation',
  },
};

const IMAGE_KIND: KindVocabulary = {
  icon: 'mdi-image-outline',
  caption: 'Active dataset',
  noun: 'image',
};

const multiple = computed(
  () => props.param.kind === 'sourceRef' && props.param.multiple === true
);

// Before the binder has run, a param accepting exactly one type already names
// its kind.
const kind = computed(() => {
  const declared =
    props.param.kind === 'sourceRef' && props.param.accepts.length === 1
      ? props.param.accepts[0]
      : undefined;
  const type = props.boundType ?? declared;
  const resolved = (type ? KINDS[type] : undefined) ?? IMAGE_KIND;
  const caption =
    (multiple.value ? resolved.pluralCaption : undefined) ?? resolved.caption;
  return { ...resolved, caption };
});

const OPTIONAL_UNBOUND_STATES = new Set<SourceRefBindingState>([
  'unbound',
  'no-segment-group',
  'no-annotations',
  'no-reference-input',
]);

// Missing optional inputs are an intentional task state, not an instruction
// the user must satisfy. Provenance failures and ambiguous bindings still show
// as errors because those states block even optional source refs.
const optionalUnbound = computed(
  () =>
    !props.param.required &&
    props.binding != null &&
    OPTIONAL_UNBOUND_STATES.has(props.binding)
);

const bindingMessage = computed(() =>
  props.binding && !optionalUnbound.value
    ? bindingStateMessage(props.binding, kind.value.noun, multiple.value)
    : undefined
);

const boundDisplayName = computed(() =>
  optionalUnbound.value
    ? 'Not provided'
    : (props.boundName ?? kind.value.caption)
);
</script>

<style scoped>
.file-widget {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 20px;
  align-items: start;
  padding: 2px 0;
}
.input-key {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 20px;
}
.input-key :deep(.v-icon) {
  flex: 0 0 auto;
}
.input-value {
  min-width: 0;
  line-height: 20px;
  text-align: left;
}
.value-text {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
