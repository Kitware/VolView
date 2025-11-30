import RpcClient from '@/src/core/remote/client';
import { StoreApi } from '@/src/core/remote/storeApi';
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';

const { VITE_REMOTE_SERVER_URL } = import.meta.env;

export enum ConnectionState {
  Disconnected,
  Pending,
  Connected,
}

export const useServerStore = defineStore('server', () => {
  const url = ref(VITE_REMOTE_SERVER_URL ?? '');
  const connState = ref<ConnectionState>(ConnectionState.Disconnected);

  const client = new RpcClient(StoreApi);

  client.socket.on('disconnect', () => {
    connState.value = ConnectionState.Disconnected;
  });

  async function connect() {
    if (!url.value) {
      return;
    }

    connState.value = ConnectionState.Pending;
    try {
      await client.connect(url.value);
      connState.value = ConnectionState.Connected;
    } catch {
      connState.value = ConnectionState.Disconnected;
    }
  }

  async function disconnect() {
    await client.disconnect();
  }

  function setUrl(newUrl: string) {
    url.value = newUrl;
    disconnect();
  }

  return {
    url,
    client: markRaw(client),
    connState,
    connect,
    disconnect,
    setUrl,
  };
});
