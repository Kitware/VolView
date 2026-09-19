<script setup lang="ts" generic="T extends { id: string; name: string }">
/* global T */

import { nextTick, ref, watch } from 'vue';
import { Maybe } from '@/src/types';

const emit = defineEmits<{
  create: [];
  'update:model-value': [id: string];
  move: [id: string, target: string, after: boolean];
}>();

const props = defineProps<{
  items: Array<T>;
  createText: string;
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
      <v-list-item
        v-for="item in items"
        :key="item.id"
        v-memo="[item, item.id === modelValue]"
        class="item-row"
        @dragover="dragOver($event, item.id)"
        @drop="drop($event, item.id)"
        @dragleave="leaveRow"
        :active="item.id === modelValue"
        :aria-label="item.name"
        :aria-current="item.id === modelValue ? 'true' : undefined"
        @click="emit('update:model-value', item.id)"
      >
        <div class="d-flex align-center flex-nowrap">
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
          <v-tooltip :eager="false" :text="item.name" location="end">
            <template #activator="{ props: tooltip }">
              <v-list-item-title v-bind="tooltip">{{
                item.name
              }}</v-list-item-title>
            </template>
          </v-tooltip>
          <span class="ml-auto flex-shrink-0 d-flex align-center">
            <slot name="item-append" :item="item"></slot>
          </span>
        </div>
      </v-list-item>
    </div>

    <div role="listitem" class="create-row-wrapper">
      <v-list-item
        tag="button"
        type="button"
        role="button"
        class="create-row w-100"
        @click="emit('create')"
      >
        <div class="d-flex align-center">
          <v-icon class="create-icon mr-3" size="18">mdi-plus</v-icon>
          <span class="text-body-2">{{ createText }}</span>
        </div>
      </v-list-item>
    </div>
  </v-list>
</template>

<style scoped>
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

/* Without it the title refuses to shrink and pushes the row controls off. */
.item-row .v-list-item-title {
  min-width: 0;
}

.v-list-item.item-row,
.v-list-item.create-row {
  border: 1px solid transparent;
  border-radius: 4px;
  /* The default inset would dwarf the gaps between the row's parts. */
  padding-inline: 4px;
}

.item-row.v-list-item--active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.item-row[data-drop-position='before'] {
  border-top-color: rgb(var(--v-theme-primary));
}
.item-row[data-drop-position='after'] {
  border-bottom-color: rgb(var(--v-theme-primary));
}

/* Vuetify's active tint would lighten the app's selection color. */
.item-row.v-list-item--active :deep(.v-list-item__overlay) {
  opacity: 0;
}

.create-row {
  opacity: var(--v-medium-emphasis-opacity);
}

.create-icon {
  flex: 0 0 18px;
}
</style>
