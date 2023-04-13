import { onBeforeUnmount, onMounted } from 'vue';
import { useMessageStore } from '../store/messages';

export function useGlobalErrorHook() {
  const messageStore = useMessageStore();

  const onError = (event: ErrorEvent) => {
    messageStore.addError('Application error (click for details)', event.error);
  };

  onMounted(() => {
    window.addEventListener('error', onError);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('error', onError);
  });
}
