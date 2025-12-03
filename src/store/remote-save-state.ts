import { serialize } from '@/src/io/state-file/serialize';
import { useMessageStore } from '@/src/store/messages';
import { $fetch } from '@/src/utils/fetch';
import { defineStore } from 'pinia';
import { ref } from 'vue';

const useRemoteSaveStateStore = defineStore('remoteSaveState', () => {
  const saveUrl = ref('');
  const isSaving = ref(false);

  const messageStore = useMessageStore();

  const setSaveUrl = (url: string) => {
    saveUrl.value = url;
  };

  const saveState = async () => {
    if (!saveUrl.value || isSaving.value) return;
    try {
      isSaving.value = true;

      const blob = await serialize();
      const saveResult = await $fetch(saveUrl.value, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': blob.size.toString(),
        },
        body: blob,
      });

      if (saveResult.ok) messageStore.addSuccess('Save Successful');
      else messageStore.addError('Save Failed', 'Network response not OK');
    } catch (error) {
      messageStore.addError('Save Failed with error', `Failed from: ${error}`);
    } finally {
      isSaving.value = false;
    }
  };

  return {
    saveUrl,
    setSaveUrl,
    isSaving,
    saveState,
  };
});

export default useRemoteSaveStateStore;
