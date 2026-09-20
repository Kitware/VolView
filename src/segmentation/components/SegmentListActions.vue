<script setup lang="ts">
defineProps<{
  name: string;
  locked: boolean;
  visible: boolean;
  viewingCine: boolean;
  revealReason: string;
}>();

defineEmits(['toggle-lock', 'reveal', 'edit', 'toggle-visible', 'delete']);

// Locking is the whole opt-in for overlap, and nothing else on screen says so.
const lockTooltip = (locked: boolean) =>
  locked
    ? 'Unlock. Painting over this segment takes its voxels.'
    : 'Lock. Painting over this segment shares its voxels instead of taking them.';
</script>

<template>
  <!-- Reveal content without changing the view's pan or zoom. -->
  <span class="d-inline-flex" :tabindex="revealReason ? 0 : undefined">
    <v-btn
      icon
      size="small"
      density="compact"
      class="mr-1"
      variant="plain"
      data-testid="reveal-segment-button"
      :aria-label="`${viewingCine ? 'Reveal frame' : 'Reveal slice'} for ${name}`"
      :disabled="!!revealReason"
      @click.stop="$emit('reveal')"
    >
      <v-icon>mdi-target</v-icon>
    </v-btn>
    <v-tooltip :eager="false" location="top" activator="parent">{{
      revealReason || (viewingCine ? 'Reveal Frame' : 'Reveal Slice')
    }}</v-tooltip>
  </span>
  <span class="d-inline-flex" :tabindex="locked ? 0 : undefined">
    <v-btn
      icon="mdi-pencil"
      size="small"
      density="compact"
      class="mr-1"
      variant="plain"
      data-testid="edit-segment-button"
      :aria-label="`Edit ${name}`"
      @click.stop="$emit('edit')"
      :disabled="locked"
    />
    <v-tooltip :eager="false" location="top" activator="parent">{{
      locked ? 'Unlock this segment to edit it' : 'Edit'
    }}</v-tooltip>
  </span>
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
  <span class="d-inline-flex" :tabindex="locked ? 0 : undefined">
    <v-btn
      icon="mdi-delete"
      size="small"
      density="compact"
      variant="plain"
      data-testid="delete-segment-button"
      :aria-label="`Delete ${name} from every image`"
      @click.stop="$emit('delete')"
      :disabled="locked"
    />
    <v-tooltip :eager="false" location="top" activator="parent">{{
      locked ? 'Unlock this segment to delete it' : 'Delete from every image'
    }}</v-tooltip>
  </span>
</template>
