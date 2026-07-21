import { serialize } from '@/src/io/state-file/serialize';
import { useMessageStore } from '@/src/store/messages';
import { isOriginAllowed } from '@/src/io/originGate';
import { $fetch } from '@/src/utils/fetch';
import { defineStore } from 'pinia';
import { ref } from 'vue';

// On a successful save the backend returns a single field, `resumeUrl` — the
// session's save/load URL. The client repoints BOTH the tab's `urls=` (so a
// future F5 reloads the just-made save instead of the fresh launch manifest) AND
// its `save=` (so subsequent saves target the SAME session item — item-scoped —
// instead of minting a new session zip each time) at it, via
// `history.replaceState` (no reload). VolView constructs no Girder route and
// never learns the item id; it only knows "point future refreshes and saves at
// `resumeUrl`." A response without `resumeUrl` (or an unparseable body) leaves
// the tab as-is (fail-safe). `config=` is untouched.
const repointToResumeUrl = (resumeUrl: string) => {
  const url = new URL(window.location.toString());
  const params = new URLSearchParams(url.search);
  params.set('urls', resumeUrl); // future F5 reloads the save
  params.set('save', resumeUrl); // future saves go item-scoped into the same item
  url.search = `?${params.toString()}`;
  window.history.replaceState(null, '', url.toString());
};

const useRemoteSaveStateStore = defineStore('remoteSaveState', () => {
  const saveUrl = ref('');
  const isSaving = ref(false);

  const messageStore = useMessageStore();

  // The remote-save target passes the SAME runtime egress gate as processing
  // providers — one gate for all configured egress. A cross-origin target never
  // reaches `saveUrl`, so the remote-save surface (gated on `saveUrl !== ''`)
  // and its egress both stay inert. Only a same-origin target is accepted.
  const setSaveUrl = (url: string) => {
    if (isOriginAllowed(url)) {
      saveUrl.value = url;
    } else {
      saveUrl.value = '';
      messageStore.addWarning('Remote save unavailable', {
        details: `The configured save target is not allowed: ${url}`,
        persist: true,
      });
      console.warn(
        `Ignoring remote-save URL because its origin is not allowed: ${url}`
      );
    }
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
          if (
            body &&
            typeof body.resumeUrl === 'string' &&
            isOriginAllowed(body.resumeUrl)
          ) {
            // Same-origin resumeUrl only (matches the setSaveUrl egress gate):
            // stamp urls=/save= for an F5-stable resume AND re-target in-session
            // saves at the same item. A cross-origin resumeUrl is a fail-safe
            // no-op — the tab is left as-is (no address-bar stamp, saveUrl
            // unchanged, no persistent warning); the save still succeeded, but a
            // later F5 will not repoint (acceptable under the same-origin policy).
            repointToResumeUrl(body.resumeUrl);
            setSaveUrl(body.resumeUrl);
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
