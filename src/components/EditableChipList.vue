<script
  setup
  lang="ts"
  generic="T, KeyProp extends keyof T, TitleProp extends keyof T"
>
/* global T, KeyProp, TitleProp */

import { computed } from 'vue';
import { Maybe } from '@/src/types';

defineEmits(['select', 'edit', 'create', 'update:model-value']);

const props = withDefaults(
  defineProps<{
    items: Array<T>;
    itemKey: T[KeyProp] extends string | number | symbol ? KeyProp : never;
    itemTitle: T[TitleProp] extends string ? TitleProp : never;
    createLabelText?: string;
    modelValue: Maybe<T[KeyProp]>;
  }>(),
  {
    createLabelText: 'Create Label',
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
  <v-item-group
    :model-value="modelValue"
    @update:model-value="$emit('update:model-value', $event)"
    selected-class="selected"
    mandatory
  >
    <v-row dense>
      <v-col
        cols="12"
        v-for="({ key, title }, idx) in itemsToRender"
        :key="key"
      >
        <v-item v-slot="{ selectedClass, toggle }" :value="key">
          <v-chip
            variant="tonal"
            :class="['w-100 d-flex', selectedClass]"
            @click="toggle"
          >
            <slot name="item-prepend" :key="key" :item="items[idx]"></slot>
            <v-tooltip :text="title" location="end">
              <template #activator="{ props }">
                <span v-bind="props" class="text-truncate">{{ title }}</span>
              </template>
            </v-tooltip>
            <v-spacer />
            <slot name="item-append" :key="key" :item="items[idx]"></slot>
          </v-chip>
        </v-item>
      </v-col>

      <!-- Add Label button -->
      <v-col cols="12">
        <v-chip variant="outlined" class="w-100" @click="$emit('create')">
          <v-icon class="mr-2">mdi-plus</v-icon>
          {{ createLabelText }}
        </v-chip>
      </v-col>
    </v-row>
  </v-item-group>
</template>

<style scoped>
.selected {
  background-color: rgb(var(--v-theme-selection-bg-color));
  border-color: rgb(var(--v-theme-selection-border-color));
}

.v-chip:deep() .v-chip__content {
  width: 100%;
}
</style>
