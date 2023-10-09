<template>
  <closeable-dialog v-model="keyboardStore.settingsOpen">
    <v-card>
      <v-card-title class="d-flex flex-row align-center"
        >Keyboard Shortcuts</v-card-title
      >
      <v-table class="pa-4">
        <thead>
          <th class="text-left">Command</th>
          <th class="text-left">Keybinding</th>
        </thead>
        <tbody>
          <tr v-for="[action, key] in bindings" :key="action">
            <td>{{ action }}</td>
            <td>{{ key }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </closeable-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { useKeyboardShortcutsStore } from '@/src/store/keyboard-shortcuts';
import { ACTIONS } from '@/src/constants';
import CloseableDialog from './CloseableDialog.vue';
import { getEntries } from '../utils';

const keyboardStore = useKeyboardShortcutsStore();

const bindings = computed(() =>
  getEntries(actionToKey.value).map(([action, key]) => [
    ACTIONS[action].readable,
    key,
  ])
);
</script>
