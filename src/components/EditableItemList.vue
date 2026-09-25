<script
  setup
  lang="ts"
  generic="T, KeyProp extends keyof T, TitleProp extends keyof T"
>
/* global T, KeyProp, TitleProp */

import { computed, nextTick, ref, watch } from 'vue';
import { Maybe } from '@/src/types';

const emit = defineEmits([
  'create',
  'update:model-value',
  'update:expanded',
  'move',
]);

const props = withDefaults(
  defineProps<{
    items: Array<T>;
    itemKey: T[KeyProp] extends string | number | symbol ? KeyProp : never;
    itemTitle: T[TitleProp] extends string ? TitleProp : never;
    createText?: string;
    hideCreate?: boolean;
    reorderable?: boolean;
    modelValue: Maybe<T[KeyProp]>;
    selectionRevision?: number;
    expandable?: (item: T) => boolean;
    expanded?: Array<string | number | symbol>;
  }>(),
  {
    createText: 'Create',
    hideCreate: false,
    reorderable: false,
    expandable: () => false,
    expanded: () => [],
  }
);

const itemsToRender = computed(() =>
  props.items.map((item) => ({
    item,
    key: item[props.itemKey] as string | number | symbol,
    title: item[props.itemTitle] as string | undefined,
    expandable: props.expandable(item),
  }))
);

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

const isOpen = (key: string | number | symbol) => props.expanded.includes(key);

const toggleOpen = (key: string | number | symbol) =>
  emit(
    'update:expanded',
    isOpen(key)
      ? props.expanded.filter((open) => open !== key)
      : [...props.expanded, key]
  );

type ItemKey = string | number | symbol;
let draggedKey: ItemKey | undefined;
let highlightedRow: HTMLElement | undefined;

// Drag feedback only changes the previous and current row, not list data.
const clearIndicator = () => {
  highlightedRow?.removeAttribute('data-drop-position');
  highlightedRow = undefined;
};

const clearDrag = () => {
  draggedKey = undefined;
  clearIndicator();
};

const startDrag = (event: DragEvent, key: ItemKey) => {
  if (!event.dataTransfer) return;
  draggedKey = key;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-volview-segment-id', String(key));
};

const isAfter = (event: DragEvent) => {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2;
};

const dragOver = (event: DragEvent, key: ItemKey) => {
  if (draggedKey === undefined) return;
  if (draggedKey === key) {
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

const drop = (event: DragEvent, key: ItemKey) => {
  if (draggedKey === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  if (draggedKey !== key) emit('move', draggedKey, key, isAfter(event));
  clearDrag();
};

const moveBy = async (key: ItemKey, offset: number, event: KeyboardEvent) => {
  const index = itemsToRender.value.findIndex((item) => item.key === key);
  const target = itemsToRender.value[index + offset];
  if (!target) return;
  const handle = event.currentTarget as HTMLElement;
  emit('move', key, target.key, offset > 0);
  await nextTick();
  handle.focus();
};
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <!-- Selection is mandatory: clicking a row picks it, and nothing clears it
         back to none. -->
    <div ref="listElement" class="item-list-scroll">
      <!-- Open expansion slots can change independently of their row data. -->
      <!-- eslint-disable vue/no-useless-template-attributes -- Vue compiles v-memo on the keyed v-for fragment. -->
      <template
        v-for="{ item, key, title, expandable: hasMore } in itemsToRender"
        :key="key"
        v-memo="[
          item,
          title,
          key === modelValue,
          hasMore,
          isOpen(key) ? {} : false,
          reorderable,
        ]"
      >
        <v-list-item
          class="item-row"
          @dragover="dragOver($event, key)"
          @drop="drop($event, key)"
          @dragleave="leaveRow"
          :active="key === modelValue"
          :aria-label="title"
          :aria-current="key === modelValue ? 'true' : undefined"
          @click="$emit('update:model-value', key)"
        >
          <div class="d-flex align-center flex-nowrap">
            <button
              v-if="reorderable"
              type="button"
              class="reorder-handle"
              draggable="true"
              :aria-label="`Reorder ${title}`"
              title="Drag to reorder segments and shortcuts. Earlier segments render in front. Alt+Up or Alt+Down also moves this segment."
              @click.stop
              @dragstart.stop="startDrag($event, key)"
              @dragend="clearDrag"
              @keydown.alt.up.stop.prevent="moveBy(key, -1, $event)"
              @keydown.alt.down.stop.prevent="moveBy(key, 1, $event)"
            >
              <v-icon size="16">mdi-drag-horizontal-variant</v-icon>
            </button>
            <v-btn
              v-if="hasMore"
              icon
              size="small"
              density="compact"
              variant="plain"
              class="expand-button mr-1"
              data-testid="expand-segment-button"
              :aria-label="`Details for ${title}`"
              :aria-expanded="isOpen(key)"
              @click.stop="toggleOpen(key)"
            >
              <v-icon>{{
                isOpen(key) ? 'mdi-chevron-down' : 'mdi-chevron-right'
              }}</v-icon>
            </v-btn>
            <slot name="item-prepend" :item="item"></slot>
            <v-tooltip :eager="false" :text="title" location="end">
              <template #activator="{ props: tooltip }">
                <v-list-item-title v-bind="tooltip">{{
                  title
                }}</v-list-item-title>
              </template>
            </v-tooltip>
            <span class="ml-auto flex-shrink-0 d-flex align-center">
              <slot name="item-append" :item="item"></slot>
            </span>
          </div>
        </v-list-item>

        <div v-if="hasMore && isOpen(key)" class="item-expansion">
          <slot name="item-expansion" :item="item"></slot>
        </div>
      </template>
      <!-- eslint-enable vue/no-useless-template-attributes -->
    </div>

    <div v-if="!hideCreate" role="listitem" class="create-row-wrapper">
      <v-list-item
        tag="button"
        type="button"
        role="button"
        class="create-row w-100"
        @click="$emit('create')"
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
  /* The list's default inset would dwarf the gaps between the row's own parts. */
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

/* Square keeps the chevron round instead of squashed by the row. */
.expand-button {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
}

.item-expansion {
  margin-left: 44px;
}
</style>
