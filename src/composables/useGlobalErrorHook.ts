import { onBeforeUnmount, onMounted } from 'vue';
import { captureException } from '@sentry/vue';
import { useMessageStore } from '../store/messages';

export function useGlobalErrorHook() {
  const messageStore = useMessageStore();

  const onError = (event: ErrorEvent) => {
    console.error(event);
    const errorMessage = event.message ?? 'Unknown global error';

    captureException(event.error ?? errorMessage);

    const details = event.error ? event.error : { details: errorMessage };
    messageStore.addError('Application error (click for details)', details);
  };

  onMounted(() => {
    window.addEventListener('error', onError);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('error', onError);
  });
}
