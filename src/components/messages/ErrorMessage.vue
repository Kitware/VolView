<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  props: {
    message: String,
    error: Error,
  },
});
</script>

<template>
  <v-expansion-panel>
    <v-expansion-panel-header class="error-message">
      <div class="header">
        <span>Error</span>
        <v-btn icon small class="mr-3" @click.stop="$emit('delete')">
          <v-icon small>mdi-delete</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-header>
    <v-expansion-panel-content>
      <div class="mt-4">
        <pre>{{ message || 'An unknown error occurred (empty message)' }}</pre>
        <pre v-if="error">{{ error }}</pre>
      </div>
    </v-expansion-panel-content>
  </v-expansion-panel>
</template>

<style scoped src="@/src/components/styles/messages.css"></style>
