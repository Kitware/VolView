import { isOriginAllowed } from '@/src/io/originGate';
import { serialize } from '@/src/io/state-file/serialize';
import { useMessageStore } from '@/src/store/messages';
import { $fetch } from '@/src/utils/fetch';
import { repointLaunchUrls } from '@/src/utils/urlParams';
import { defineStore } from 'pinia';
import { ref } from 'vue';

const useRemoteSaveStateStore = defineStore('remoteSaveState', () => {
  const saveUrl = ref('');
  const isSaving = ref(false);

  const messageStore = useMessageStore();

  // A save target is accepted only if it is same-origin with the served client.
  // Refusing leaves `saveUrl` empty, which inerts the save UI (it is gated on a
  // non-empty target) — so a deployment that serves no save endpoint of its own,
  // such as the public demo, simply has no save, with nothing to configure and
  // no build flag to forget. This is what keeps a crafted `?save=` link from
  // POSTing the session to a third-party origin.
  const setSaveUrl = (url: string) => {
    if (!isOriginAllowed(url)) {
      saveUrl.value = '';
      messageStore.addError('Save Disabled', {
        details: `Refused a cross-origin save target: ${url}`,
      });
      return;
    }
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

      if (saveResult.ok) {
        // Repoint future refreshes at the saved session when the backend
        // returns a `resumeUrl` (see repointLaunchUrls): a folder-scoped save
        // mints a new session zip item per save and F5 follows the newest,
        // while the in-memory save target stays on the launch-provided
        // `save=`. VolView constructs no Girder route and never learns the
        // item id. A non-JSON / bodyless / `resumeUrl`-less response is a
        // fail-safe no-op — the ordinary save still succeeded.
        try {
          const body = await saveResult.json();
          if (body && typeof body.resumeUrl === 'string') {
            repointLaunchUrls(body.resumeUrl);
          }
        } catch {
          // leave the tab as-is
        }
        messageStore.addSuccess('Save Successful');
      } else {
        messageStore.addError('Save Failed', {
          details: 'Network response not OK',
        });
      }
    } catch (error) {
      messageStore.addError('Save Failed with error', {
        details: `Failed from: ${error}`,
      });
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
