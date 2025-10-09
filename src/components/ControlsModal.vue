<template>
  <closeable-dialog v-model="keyboardStore.settingsOpen" :close-offset-x="24">
    <v-card class="pa-4">
      <div class="text-h4 pb-2">View Controls</div>
      <v-table>
        <tbody>
          <tr>
            <td>Scroll Slices</td>
            <td>Mouse wheel or 2 finger vertical scroll</td>
          </tr>
          <tr>
            <td>Zoom</td>
            <td>Right mouse button + move vertically</td>
          </tr>
          <tr>
            <td>Pan</td>
            <td>Shift + left mouse button + move</td>
          </tr>
        </tbody>
      </v-table>

      <div class="text-h4 pb-2">Keyboard Shortcuts</div>
      <v-table>
        <tbody>
          <tr v-for="[action, key] in bindings" :key="action">
            <td>{{ action }}</td>
            <td class="keybinding">{{ key }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </closeable-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { ACTIONS } from '@/src/constants';
import { useKeyboardShortcutsStore } from '@/src/store/keyboard-shortcuts';
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

<style scoped>
.keybinding {
  font-family: monospace;
}
</style>
