<script
  setup
  lang="ts"
  generic="T, KeyProp extends keyof T, TitleProp extends keyof T"
>
/* global T, KeyProp, TitleProp */

import { computed } from 'vue';
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
  }>(),
  {
    createText: 'Create',
    hideCreate: false,
  }
);

const itemsToRender = computed(() =>
  props.items.map((item) => ({
    key: item[props.itemKey] as string | number | symbol,
    title: item[props.itemTitle] as string | undefined,
  }))
);
</script>

<template>
  <v-list density="compact" bg-color="transparent" class="py-0">
    <!-- Selection is mandatory: clicking a row picks it, and nothing clears it
         back to none. -->
    <v-list-item
      v-for="({ key, title }, idx) in itemsToRender"
      :key="key"
      class="item-row"
      :active="key === modelValue"
      @click="$emit('update:model-value', key)"
    >
      <div class="d-flex align-center flex-nowrap">
        <slot name="item-prepend" :key="key" :item="items[idx]"></slot>
        <v-tooltip :text="title" location="end">
          <template #activator="{ props: tooltip }">
            <v-list-item-title v-bind="tooltip">{{ title }}</v-list-item-title>
          </template>
        </v-tooltip>
        <span class="ml-auto flex-shrink-0 d-flex align-center">
          <slot name="item-append" :key="key" :item="items[idx]"></slot>
        </span>
      </div>
    </v-list-item>

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
</style>
