import { TYPE } from 'vue-toastification';
import { useToast } from '@/src/composables/useToast';
import { ToastID } from 'vue-toastification/dist/types/src/types';
import { useMessageStore } from '../store/messages';

export function useAppLoadingNotifications() {
  const toast = useToast();
  const messageStore = useMessageStore();

  let loadingCount = 0;
  let toastID: ToastID | null = null;
  let error: Error | null = null;

  const resetState = () => {
    loadingCount = 0;
    toastID = null;
    error = null;
  };

  const _setError = (err: Error) => {
    error = err;
  };

  const startLoading = () => {
    loadingCount++;
    if (toastID === null) {
      toastID = toast.info('Loading datasets...', {
        timeout: false,
        closeButton: false,
        closeOnClick: false,
      });
    }
  };

  const stopLoading = () => {
    loadingCount--;
    if (loadingCount === 0 && toastID !== null) {
      if (error) {
        toast.dismiss(toastID);
        messageStore.addError('Some files failed to load', error);
      } else {
        toast.update(toastID, {
          content: 'Datasets loaded!',
          options: {
            type: TYPE.SUCCESS,
            timeout: 3000,
            closeButton: 'button',
            closeOnClick: true,
          },
        });
      }
      resetState();
    }
  };

  /**
   * Notifies of loading status until all function calls return.
   * @param fn function to call
   * @returns whatever fn returns.
   */
  const runAsLoading = async (fn: (setError: typeof _setError) => void) => {
    startLoading();
    try {
      return await fn(_setError);
    } finally {
      stopLoading();
    }
  };

  return {
    runAsLoading,
  };
}
