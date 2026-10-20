<script setup lang="ts">
defineProps<{
  message: string | null;
  ready: boolean;
  retryable: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div
    :class="message ? 'projection-status' : 'd-sr-only'"
    role="status"
    aria-live="polite"
    data-testid="oct-projection-status"
  >
    <span>{{ message || (ready ? 'En face projection ready.' : '') }}</span>
    <v-btn
      v-if="retryable"
      size="small"
      variant="outlined"
      @click="emit('retry')"
      >Retry projection</v-btn
    >
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
}
</style>
