import { onBeforeUnmount, onMounted } from 'vue';
import { captureException } from '@sentry/vue';
import { useMessageStore } from '../store/messages';

export function useGlobalErrorHook() {
  const messageStore = useMessageStore();

  const onError = (event: ErrorEvent) => {
    console.error(event);
    const error = event.error ?? event.message ?? 'Unknown global error';

    captureException(error);

    const errorOptions =
      error instanceof Error ? { error } : { details: String(error) };
    messageStore.addError(
      'Application error (click for details)',
      errorOptions
    );
  };

  onMounted(() => {
    window.addEventListener('error', onError);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('error', onError);
  });
}
