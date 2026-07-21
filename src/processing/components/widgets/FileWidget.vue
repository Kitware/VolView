<template>
  <div class="file-widget">
    <div class="text-caption font-weight-medium">
      {{ param.title || param.id }}
      <span v-if="param.required" class="text-error">*</span>
    </div>
    <div class="text-caption">
      <span v-if="binding === 'no-provenance'" class="text-error">
        The active volume was not loaded from the server, so it cannot be used
        as an input.
      </span>
      <span v-else-if="binding === 'no-segment-group'" class="text-error">
        Paint or select a segment group first.
      </span>
      <span v-else-if="binding === 'ambiguous'" class="text-error">
        This task needs more than one
        {{ isLabelmap ? 'segment group' : 'image' }}
        input, which this version cannot bind automatically.
      </span>
      <span v-else-if="isBound" class="bound-name">
        <v-icon size="14" class="mr-1">
          {{ isLabelmap ? 'mdi-brush-outline' : 'mdi-image-outline' }}
        </v-icon>
        {{
          boundName ?? (isLabelmap ? 'Active segment group' : 'Active dataset')
        }}
      </span>
      <span v-else class="text-medium-emphasis">
        {{
          isLabelmap
            ? 'Input — binds to a painted segment group at submit'
            : 'Input — binds to the active dataset at submit'
        }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VolViewTaskParameter, InputValue } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';
import type { SourceRefBindingState } from '@/src/processing/engine/mintInput';

// Renders a `sourceRef` input. The bound value ({ type, format?, uris }) is
// authored by the parent at submit — from provenance for an `image` input,
// or from the staging response for a `labelmap` input.
// This widget only reflects the resolved state; it never mints and there is no
// picker (v1).
const props = defineProps<{
  param: VolViewTaskParameter;
  modelValue: InputValue | null | undefined;
  // Fail-closed/bound state resolved by the parent's binder.
  binding?: SourceRefBindingState;
  // Display name of what the input is bound to (dataset / segment-group name).
  boundName?: string;
}>();

// A labelmap sourceRef binds to a segment group (staged at Run), not the active
// dataset — so its bound/hint copy differs from an image input's.
const isLabelmap = computed(
  () =>
    props.param.kind === 'sourceRef' &&
    props.param.accepts.includes(TYPE_TAG_LABELMAP)
);

const isBound = computed(
  () =>
    (props.binding === 'bound' && isLabelmap.value) ||
    (props.modelValue?.uris.length ?? 0) > 0
);
</script>

<style scoped>
.file-widget {
  padding: 6px 0;
}
.bound-name {
  display: inline-flex;
  align-items: center;
}
</style>
