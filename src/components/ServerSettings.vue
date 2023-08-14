<script setup lang="ts">
import { computed } from 'vue';
import { ConnectionState, useServerStore } from '@/src/store/server';
import { storeToRefs } from 'pinia';

const serverStore = useServerStore();
const { connState } = storeToRefs(serverStore);

const serverUrl = computed({
  get() {
    return serverStore.url;
  },
  set(url: string) {
    serverStore.setUrl(url);
  },
});

const StatusToText: Record<ConnectionState, string> = {
  [ConnectionState.Connected]: 'Connected',
  [ConnectionState.Disconnected]: 'Disconnected',
  [ConnectionState.Pending]: 'Connecting...',
};

const connStatus = computed(() => StatusToText[connState.value]);

function toggleConnection() {
  if (connState.value === ConnectionState.Connected) {
    serverStore.disconnect();
  } else if (connState.value === ConnectionState.Disconnected) {
    serverStore.connect();
  }
}

const connectBtnText = computed(() => {
  return connState.value === ConnectionState.Connected
    ? 'Disconnect'
    : 'Connect';
});
</script>

<template>
  <div class="ma-2">
    <h3>Remote Server</h3>
    <div class="mt-4">
      <v-text-field
        v-model="serverUrl"
        label="Server URL"
        clearable
        persistent-hint
        hint="Make sure you trust the remote server!"
      />
    </div>
    <div class="mt-4">
      <v-btn
        color="secondary"
        @click="toggleConnection"
        :loading="connState === ConnectionState.Pending"
      >
        {{ connectBtnText }}
      </v-btn>
      <span class="ml-5">Status: {{ connStatus }}</span>
    </div>
  </div>
</template>
