<script setup lang="ts">
defineProps<{ message: string | null }>();
</script>

<template>
  <div
    v-if="message"
    class="measurement-status"
    role="status"
    aria-live="polite"
    data-testid="enface-measurement-status"
  >
    {{ message }}
  </div>
</template>

<style scoped>
.measurement-status {
  position: absolute;
  bottom: 8px;
  left: 12px;
  right: 80px;
  padding: 4px 6px;
  background: rgb(0 0 0 / 65%);
  border-radius: 4px;
  color: white;
  font-size: 0.75rem;
  pointer-events: none;
}
</style>
