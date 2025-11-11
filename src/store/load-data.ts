import { useMessageStore } from '@/src/store/messages';
import { Maybe } from '@/src/types';
import { logError } from '@/src/utils/loggers';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useToast } from '@/src/composables/useToast';
import { TYPE } from 'vue-toastification';
import { ToastID, ToastOptions } from 'vue-toastification/dist/types/types';

const NotificationMessages = {
  Loading: 'Loading datasets...',
  Done: 'Datasets loaded!',
  Error: 'Some files failed to load',
};

const LoadingToastOptions = {
  type: TYPE.INFO,
  timeout: false,
  closeButton: false,
  closeOnClick: false,
} satisfies ToastOptions;

export function useLoadingNotifications() {
  const messageStore = useMessageStore();

  const loadingCount = ref(0);
  const loadingError = ref<Maybe<Error>>();

  const startLoading = () => {
    loadingCount.value += 1;
  };

  const stopLoading = () => {
    if (loadingCount.value === 0) return;
    loadingCount.value -= 1;
  };

  const setError = (err: Error) => {
    loadingError.value = err;
  };

  const toast = useToast();
  let toastID: Maybe<ToastID> = null;

  const showLoadingToast = () => {
    if (toastID == null) {
      toastID = toast.info(NotificationMessages.Loading, LoadingToastOptions);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Loading,
        options: LoadingToastOptions,
      });
    }
  };

  const showResults = () => {
    if (toastID == null) return;
    const error = loadingError.value;
    loadingError.value = null;

    if (error) {
      logError(error);
      toast.dismiss(toastID);
      messageStore.addError(NotificationMessages.Error, error);
    } else {
      toast.update(toastID, {
        content: NotificationMessages.Done,
        options: {
          type: TYPE.SUCCESS,
          timeout: 3000,
          closeButton: 'button',
          closeOnClick: true,
          onClose() {
            toastID = null;
          },
        },
      });
    }
  };

  watch(loadingCount, (count) => {
    if (count) showLoadingToast();
    else showResults();
  });

  const isLoading = computed(() => {
    return loadingCount.value > 0;
  });

  return {
    isLoading,
    startLoading,
    stopLoading,
    setError,
  };
}

const useLoadDataStore = defineStore('loadData', () => {
  const { startLoading, stopLoading, setError, isLoading } =
    useLoadingNotifications();

  const segmentGroupExtension = ref('');
  const layerExtension = ref('');

  return {
    segmentGroupExtension,
    layerExtension,
    isLoading,
    startLoading,
    stopLoading,
    setError,
  };
});

export default useLoadDataStore;
