<script setup lang="ts">
import ReasonedAction from '@/src/components/ReasonedAction.vue';

// Attributes reach the button, so the row can activate a menu.
defineOptions({ inheritAttrs: false });

defineProps<{
  icon: string;
  text: string;
  reason?: string;
}>();
</script>

<template>
  <div role="listitem" class="list-action-row">
    <reasoned-action :reason="reason" block v-slot="{ disabled }">
      <button
        type="button"
        class="action-row w-100"
        :disabled="disabled"
        v-bind="$attrs"
      >
        <span class="action-row-content">
          <v-icon class="action-row-icon mr-3" size="18">{{ icon }}</v-icon>
          <span class="text-body-2">{{ text }}</span>
        </span>
      </button>
    </reasoned-action>
  </div>
</template>

<style scoped>
.action-row-content {
  display: flex;
  align-items: center;
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: 4px;
  /* The default inset would dwarf the gaps between the row's parts. */
  padding-inline: 4px;
}

.action-row {
  opacity: var(--v-medium-emphasis-opacity);
  text-align: left;
  border-radius: 4px;
}

.action-row:hover:enabled,
.action-row:focus-visible {
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.action-row:disabled {
  opacity: var(--v-disabled-opacity);
  pointer-events: none;
}

.action-row-icon {
  flex: 0 0 18px;
}
</style>
