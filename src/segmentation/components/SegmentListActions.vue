<script setup lang="ts">
import ReasonedAction from '@/src/components/ReasonedAction.vue';

defineProps<{
  name: string;
  locked: boolean;
  visible: boolean;
  viewingCine: boolean;
  revealReason: string;
}>();

defineEmits<{
  'toggle-lock': [];
  reveal: [];
  edit: [];
  'toggle-visible': [];
  delete: [];
}>();

// Nothing else on screen says what a lock does to other segments' painting.
const lockTooltip = (locked: boolean) =>
  locked
    ? 'Unlock. Painting over this segment replaces its voxels, unless Allow Overlap is on.'
    : 'Lock. Painting other segments goes around it, or overlaps it with Allow Overlap on.';
</script>

<template>
  <!-- Reveal content without changing the view's pan or zoom. -->
  <reasoned-action
    :reason="revealReason"
    :tooltip="viewingCine ? 'Reveal Frame' : 'Reveal Slice'"
    v-slot="{ disabled }"
  >
    <v-btn
      icon
      size="small"
      density="compact"
      class="mr-1"
      variant="plain"
      data-testid="reveal-segment-button"
      :aria-label="`${viewingCine ? 'Reveal frame' : 'Reveal slice'} for ${name}`"
      :disabled="disabled"
      @click.stop="$emit('reveal')"
    >
      <v-icon>mdi-target</v-icon>
    </v-btn>
  </reasoned-action>
  <reasoned-action
    :reason="locked ? 'Unlock this segment to edit it' : ''"
    tooltip="Edit"
    v-slot="{ disabled }"
  >
    <v-btn
      icon="mdi-pencil"
      size="small"
      density="compact"
      class="mr-1"
      variant="plain"
      data-testid="edit-segment-button"
      :aria-label="`Edit ${name}`"
      @click.stop="$emit('edit')"
      :disabled="disabled"
    />
  </reasoned-action>
  <v-btn
    icon
    size="small"
    density="compact"
    class="mr-1"
    variant="plain"
    @click.stop="$emit('toggle-lock')"
    :aria-label="`${locked ? 'Unlock' : 'Lock'} ${name}`"
    :color="locked ? 'error' : undefined"
  >
    <v-icon>{{ locked ? 'mdi-lock' : 'mdi-lock-open' }}</v-icon>
    <v-tooltip :eager="false" location="top" activator="parent">{{
      lockTooltip(locked)
    }}</v-tooltip>
  </v-btn>
  <v-btn
    icon
    size="small"
    density="compact"
    class="mr-1"
    variant="plain"
    @click.stop="$emit('toggle-visible')"
    :aria-label="`${visible ? 'Hide' : 'Show'} ${name}`"
  >
    <v-icon style="pointer-events: none">{{
      visible ? 'mdi-eye' : 'mdi-eye-off'
    }}</v-icon>
    <v-tooltip :eager="false" location="top" activator="parent">{{
      visible ? 'Hide' : 'Show'
    }}</v-tooltip>
  </v-btn>
  <reasoned-action
    :reason="locked ? 'Unlock this segment to delete it' : ''"
    tooltip="Delete from every image"
    v-slot="{ disabled }"
  >
    <v-btn
      icon="mdi-delete"
      size="small"
      density="compact"
      variant="plain"
      data-testid="delete-segment-button"
      :aria-label="`Delete ${name} from every image`"
      @click.stop="$emit('delete')"
      :disabled="disabled"
    />
  </reasoned-action>
</template>
