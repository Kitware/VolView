<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <v-list-item class="item-row" :aria-label="name">
    <div class="d-flex align-center flex-nowrap">
      <slot name="prepend"></slot>
      <v-tooltip :eager="false" :text="name" location="end">
        <template #activator="{ props: tooltip }">
          <v-list-item-title v-bind="tooltip">{{ name }}</v-list-item-title>
        </template>
      </v-tooltip>
      <span class="ml-auto flex-shrink-0 d-flex align-center">
        <slot name="append"></slot>
      </span>
    </div>
  </v-list-item>
</template>

<style scoped>
/* Without it the title refuses to shrink and pushes the row controls off. */
.item-row .v-list-item-title {
  min-width: 0;
}

.v-list-item.item-row {
  border: 1px solid transparent;
  border-radius: 4px;
  /* The default inset would dwarf the gaps between the row's parts. */
  padding-inline: 4px;
}
</style>
