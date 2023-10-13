<script setup lang="ts">
const stopAllButEscape = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') {
    e.stopPropagation();
  }
};
</script>
<template>
  <v-dialog @keydown="stopAllButEscape"><slot></slot></v-dialog>
</template>
