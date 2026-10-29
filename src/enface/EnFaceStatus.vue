<script setup lang="ts">
defineProps<{
  message: string | null;
  ready: boolean;
  measurementMessage?: string | null;
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
  <div
    v-if="measurementMessage && !message"
    class="measurement-status"
    role="status"
    aria-live="polite"
    data-testid="enface-measurement-status"
  >
    {{ measurementMessage }}
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
