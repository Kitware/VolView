<script setup lang="ts" generic="T extends { id: string; name: string }">
/* global T */

import { nextTick, ref, watch } from 'vue';
import { Maybe } from '@/src/types';
import ListItemRow from '@/src/components/ListItemRow.vue';
import ReasonedAction from '@/src/components/ReasonedAction.vue';

const emit = defineEmits<{
  create: [];
  'update:model-value': [id: string];
  move: [id: string, target: string, after: boolean];
}>();

const props = defineProps<{
  items: Array<T>;
  createText: string;
  createReason?: string;
  reorderHint: string;
  modelValue: Maybe<string>;
  selectionRevision?: number;
}>();

const listElement = ref<HTMLElement>();
watch(
  [
    () => props.modelValue,
    () => props.selectionRevision,
    () => props.items.length,
    listElement,
  ],
  () => {
    const list = listElement.value;
    const row = list?.querySelector<HTMLElement>(
      '.item-row[aria-current="true"]'
    );
    if (!list || !row || !list.clientHeight) return;
    const bounds = list.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    const top = bounds.top + list.clientTop;
    const bottom = top + list.clientHeight;
    // Move only this list, keeping the surrounding controls and image fixed.
    if (item.top < top) list.scrollTop += item.top - top;
    else if (item.bottom > bottom) list.scrollTop += item.bottom - bottom;
  },
  { flush: 'post' }
);

let draggedId: string | undefined;
let highlightedRow: HTMLElement | undefined;

// Drag feedback only changes the previous and current row, not list data.
const clearIndicator = () => {
  highlightedRow?.removeAttribute('data-drop-position');
  highlightedRow = undefined;
};

const clearDrag = () => {
  draggedId = undefined;
  clearIndicator();
};

const startDrag = (event: DragEvent, id: string) => {
  if (!event.dataTransfer) return;
  draggedId = id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-volview-item-id', id);
};

const isAfter = (event: DragEvent) => {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2;
};

const dragOver = (event: DragEvent, id: string) => {
  if (draggedId === undefined) return;
  if (draggedId === id) {
    clearIndicator();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const row = event.currentTarget as HTMLElement;
  if (highlightedRow !== row) clearIndicator();
  highlightedRow = row;
  const position = isAfter(event) ? 'after' : 'before';
  if (row.dataset.dropPosition !== position)
    row.dataset.dropPosition = position;
};

const leaveRow = (event: DragEvent) => {
  const row = event.currentTarget as HTMLElement;
  if (
    highlightedRow === row &&
    (!(event.relatedTarget instanceof Node) ||
      !row.contains(event.relatedTarget))
  ) {
    clearIndicator();
  }
};

const drop = (event: DragEvent, id: string) => {
  if (draggedId === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  if (draggedId !== id) emit('move', draggedId, id, isAfter(event));
  clearDrag();
};

const moveBy = async (id: string, offset: number, event: KeyboardEvent) => {
  const index = props.items.findIndex((item) => item.id === id);
  const target = props.items[index + offset];
  if (!target) return;
  const handle = event.currentTarget as HTMLElement;
  emit('move', id, target.id, offset > 0);
  await nextTick();
  handle.focus();
};
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <!-- Selection is mandatory: clicking a row picks it, and nothing clears it
         back to none. -->
    <div ref="listElement" class="item-list-scroll">
      <list-item-row
        v-for="item in items"
        :key="item.id"
        v-memo="[item, item.id === modelValue]"
        :name="item.name"
        @dragover="dragOver($event, item.id)"
        @drop="drop($event, item.id)"
        @dragleave="leaveRow"
        :active="item.id === modelValue"
        :aria-current="item.id === modelValue ? 'true' : undefined"
        @click="emit('update:model-value', item.id)"
      >
        <template #prepend>
          <button
            type="button"
            class="reorder-handle"
            draggable="true"
            :aria-label="`Reorder ${item.name}`"
            @click.stop
            @dragstart.stop="startDrag($event, item.id)"
            @dragend="clearDrag"
            @keydown.alt.up.stop.prevent="moveBy(item.id, -1, $event)"
            @keydown.alt.down.stop.prevent="moveBy(item.id, 1, $event)"
          >
            <v-icon size="16">mdi-drag-horizontal-variant</v-icon>
            <v-tooltip
              :eager="false"
              :text="reorderHint"
              activator="parent"
              location="top"
              max-width="320"
            />
          </button>
          <slot name="item-prepend" :item="item"></slot>
        </template>
        <template #append>
          <slot name="item-append" :item="item"></slot>
        </template>
      </list-item-row>
    </div>

    <div role="listitem" class="list-actions">
      <reasoned-action :reason="createReason" v-slot="{ disabled }">
        <v-btn
          class="create-row text-none"
          variant="tonal"
          size="small"
          prepend-icon="mdi-plus"
          :disabled="disabled"
          @click="emit('create')"
        >
          {{ createText }}
        </v-btn>
      </reasoned-action>
      <slot name="actions"></slot>
    </div>
  </v-list>
</template>

<style scoped>
.list-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 4px 0;
  /* Matches the rows' border so the buttons line up with row content. */
  border-inline: 1px solid transparent;
}

.reorder-handle {
  flex: 0 0 20px;
  width: 20px;
  align-self: stretch;
  cursor: grab;
  opacity: var(--v-medium-emphasis-opacity);
}
.reorder-handle:active {
  cursor: grabbing;
}

.v-list-item.item-row.v-list-item--active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.v-list-item.item-row[data-drop-position='before'] {
  border-top-color: rgb(var(--v-theme-primary));
}
.v-list-item.item-row[data-drop-position='after'] {
  border-bottom-color: rgb(var(--v-theme-primary));
}

/* Vuetify's active tint would lighten the app's selection color. */
.item-row.v-list-item--active :deep(.v-list-item__overlay) {
  opacity: 0;
}
</style>
