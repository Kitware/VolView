<script setup lang="ts">
defineProps<{
  message: string | null;
  ready: boolean;
}>();
</script>

<template>
  <div
    :class="message ? 'projection-status' : 'd-sr-only'"
    role="status"
    aria-live="polite"
    data-testid="enface-projection-status"
  >
    <span>{{ message || (ready ? 'En face projection ready.' : '') }}</span>
  </div>
</template>

<style scoped>
.projection-status {
  position: absolute;
  inset: 32px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: white;
  text-align: center;
  pointer-events: none;
}
</style>
