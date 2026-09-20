<script setup lang="ts">
defineProps<{ color: string }>();
</script>

<template>
  <span class="color-dot" :style="{ backgroundColor: color }" />
</template>

<style scoped>
.color-dot {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #111;
}
</style>
