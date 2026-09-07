<script
  setup
  lang="ts"
  generic="T, KeyProp extends keyof T, TitleProp extends keyof T"
>
/* global T, KeyProp, TitleProp */

import { computed, ref } from 'vue';
import { Maybe } from '@/src/types';

defineEmits(['create', 'update:model-value']);

const props = withDefaults(
  defineProps<{
    items: Array<T>;
    itemKey: T[KeyProp] extends string | number | symbol ? KeyProp : never;
    itemTitle: T[TitleProp] extends string ? TitleProp : never;
    createText?: string;
    hideCreate?: boolean;
    modelValue: Maybe<T[KeyProp]>;
    /** Whether an item has anything to show under it. */
    expandable?: (item: T) => boolean;
  }>(),
  {
    createText: 'Create',
    hideCreate: false,
    expandable: () => false,
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

const openKeys = ref(new Set<string | number | symbol>());

const toggleOpen = (key: string | number | symbol) => {
  if (!openKeys.value.delete(key)) openKeys.value.add(key);
};
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <!-- Selection is mandatory: clicking a row picks it, and nothing clears it
         back to none. -->
    <template
      v-for="{ item, key, title, expandable: hasMore } in itemsToRender"
      :key="key"
    >
      <v-list-item
        class="item-row"
        :active="key === modelValue"
        @click="$emit('update:model-value', key)"
      >
        <div class="d-flex align-center flex-nowrap">
          <!-- The chevron keeps its width when there is nothing under a row,
               so the dots below it stay in one column. -->
          <v-btn
            v-if="hasMore"
            icon
            size="x-small"
            density="compact"
            variant="plain"
            class="expand-button mr-1"
            data-testid="expand-segment-button"
            @click.stop="toggleOpen(key)"
          >
            <v-icon>{{
              openKeys.has(key) ? 'mdi-chevron-down' : 'mdi-chevron-right'
            }}</v-icon>
          </v-btn>
          <span v-else class="expand-button mr-1" />
          <slot name="item-prepend" :item="item"></slot>
          <v-tooltip :text="title" location="end">
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

      <div v-if="hasMore && openKeys.has(key)" class="item-expansion">
        <slot name="item-expansion" :item="item"></slot>
      </div>
    </template>

    <v-list-item v-if="!hideCreate" class="create-row" @click="$emit('create')">
      <div class="d-flex align-center">
        <v-icon class="mr-2" size="small">mdi-plus</v-icon>
        <span class="text-body-2">{{ createText }}</span>
      </div>
    </v-list-item>
  </v-list>
</template>

<style scoped>
/* Without it the title refuses to shrink and pushes the row controls off. */
.item-row .v-list-item-title {
  min-width: 0;
}

.item-row,
.create-row {
  border: 1px solid transparent;
  border-radius: 4px;
}

.item-row.v-list-item--active {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

/* Vuetify's active tint would lighten the app's selection color. */
.item-row.v-list-item--active :deep(.v-list-item__overlay) {
  opacity: 0;
}

.create-row {
  opacity: var(--v-medium-emphasis-opacity);
}

.expand-button {
  width: 20px;
  flex: 0 0 20px;
}

.item-expansion {
  margin-left: 28px;
}
</style>
