<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';

export default defineComponent({
  props: {
    type: String as PropType<'info' | 'warn'>,
    message: String,
  },
});
</script>

<template>
  <v-expansion-panel>
    <v-expansion-panel-header :class="`${$props.type}-message`">
      <div class="header">
        <span>{{ $props.type }}</span>
        <v-btn icon small class="mr-3" @click.stop="$emit('delete')">
          <v-icon small>mdi-delete</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-header>
    <v-expansion-panel-content>
      <div class="mt-4">
        <pre>{{ message }}</pre>
      </div>
    </v-expansion-panel-content>
  </v-expansion-panel>
</template>

<style scoped src="@/src/components/styles/messages.css"></style>
