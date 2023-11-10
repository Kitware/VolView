import { onBeforeUnmount, onMounted } from 'vue';
import { useMessageStore } from '../store/messages';

export function useGlobalErrorHook() {
  const messageStore = useMessageStore();

  const onError = (event: ErrorEvent) => {
    console.error(event);
    const details = event.error
      ? event.error
      : { details: event.message ?? 'Unknown error' };
    messageStore.addError('Application error (click for details)', details);
  };

  onMounted(() => {
    window.addEventListener('error', onError);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('error', onError);
  });
}
