import { serialize } from '@/src/io/state-file/serialize';
import { useMessageStore } from '@/src/store/messages';
import { $fetch } from '@/src/utils/fetch';
import { defineStore } from 'pinia';
import { ref } from 'vue';

// On a successful save the backend returns a single field, `resumeUrl` — the
// saved session's load URL. The client repoints ONLY the tab's `urls=` at it
// (so a future F5 reloads the just-made save instead of the fresh launch
// manifest), via `history.replaceState` (no reload). `save=` and the in-memory
// save target are left alone: every save keeps going to the launch-provided
// target, so a folder-scoped save mints a new session zip item per save and F5
// follows the newest via the repointed `urls=`. VolView constructs no Girder
// route and never learns the item id; it only knows "point future refreshes at
// `resumeUrl`." A response without `resumeUrl` (or an unparseable body) leaves
// the tab as-is (fail-safe). `config=` is untouched.
const repointToResumeUrl = (resumeUrl: string) => {
  const url = new URL(window.location.toString());
  url.searchParams.set('urls', resumeUrl); // future F5 reloads the save
  // A stale names= would rename the session zip after the original data file,
  // and filename-extension typing would then misparse the zip on reload.
  url.searchParams.delete('names');
  window.history.replaceState(null, '', url.toString());
};

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

      if (saveResult.ok) {
        // Repoint future refreshes at the saved session when the backend
        // returns one. A non-JSON / bodyless / `resumeUrl`-less response is a
        // fail-safe no-op — the ordinary save still succeeded.
        try {
          const body = await saveResult.json();
          if (body && typeof body.resumeUrl === 'string') {
            // Stamp urls= for an F5-stable resume. The save target is NOT
            // repointed — saves keep going to the launch-provided target.
            repointToResumeUrl(body.resumeUrl);
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
