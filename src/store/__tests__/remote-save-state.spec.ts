import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/src/utils/fetch', () => ({
  $fetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/src/io/state-file/serialize', () => ({
  serialize: vi
    .fn()
    .mockResolvedValue(new Blob(['x'], { type: 'application/zip' })),
}));

import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import { $fetch } from '@/src/utils/fetch';
import { useMessageStore } from '@/src/store/messages';

describe('remote save target', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked($fetch).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a same-origin save URL', () => {
    const store = useRemoteSaveStateStore();
    const url = `${window.location.origin}/api/session/save`;

    store.setSaveUrl(url);

    expect(store.saveUrl).toBe(url);
  });

  it('accepts a cross-origin save URL (hosted deployments save to another origin)', async () => {
    const store = useRemoteSaveStateStore();
    const url = 'https://data.example.org/api/session/save';

    store.setSaveUrl(url);
    expect(store.saveUrl).toBe(url);

    vi.mocked($fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    await store.saveState();
    expect($fetch).toHaveBeenCalledWith(url, expect.anything());
  });
});

// On a successful save the backend returns a single
// `resumeUrl`; the client repoints ONLY the tab's `urls=` at it (a future F5
// reloads the save) — no reload; `save=`, the in-memory save target, and
// `config=` all untouched, so subsequent saves keep going to the
// launch-provided target (a folder-scoped save mints a new session item per
// save). A response without `resumeUrl` (or an unparseable body) leaves the
// tab as-is.
describe('resume repoint on save', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked($fetch).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('repoints urls= to the resumeUrl and leaves the save target alone (save=/config= untouched)', async () => {
    const resumeUrl = '/api/v1/item/session-123/volview';
    vi.mocked($fetch).mockResolvedValue(
      new Response(JSON.stringify({ resumeUrl }), { status: 200 })
    );
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    const store = useRemoteSaveStateStore();
    const launchSaveUrl = `${window.location.origin}/api/session/save`;
    store.setSaveUrl(launchSaveUrl);

    await store.saveState();

    expect(replace).toHaveBeenCalledTimes(1);
    const nextUrl = new URL(replace.mock.calls[0][2] as string);
    expect(nextUrl.searchParams.get('urls')).toBe(resumeUrl);
    // save= is never stamped: subsequent saves keep going to the
    // launch-provided target, so folder saves mint a new session item each time.
    expect(nextUrl.searchParams.get('save')).toBeNull();
    expect(store.saveUrl).toBe(launchSaveUrl);
    expect(
      useMessageStore().messages.some((m) => m.title === 'Save Successful')
    ).toBe(true);
  });

  it('drops a stale names= when repointing urls= at the session zip', async () => {
    // A launch of ?urls=<data file>&names=chest.nrrd that keeps names= after
    // the repoint retypes the session zip by the stale filename extension on
    // F5 — the NRRD reader chokes on zip bytes and the resume fails.
    window.history.replaceState(
      null,
      '',
      '?urls=%2Fchest.nrrd&names=chest.nrrd&save=%2Fapi%2Fsave'
    );
    const resumeUrl = '/api/v1/item/session-123/volview';
    vi.mocked($fetch).mockResolvedValue(
      new Response(JSON.stringify({ resumeUrl }), { status: 200 })
    );
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    const store = useRemoteSaveStateStore();
    store.setSaveUrl('/api/save');

    await store.saveState();

    expect(replace).toHaveBeenCalledTimes(1);
    const nextUrl = new URL(replace.mock.calls[0][2] as string);
    expect(nextUrl.searchParams.get('urls')).toBe(resumeUrl);
    expect(nextUrl.searchParams.get('names')).toBeNull();
    // save= keeps pointing at the launch-provided target.
    expect(nextUrl.searchParams.get('save')).toBe('/api/save');
  });

  it('leaves the tab as-is when the response carries no resumeUrl', async () => {
    vi.mocked($fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    const store = useRemoteSaveStateStore();
    store.setSaveUrl(`${window.location.origin}/api/session/save`);

    await store.saveState();

    expect(replace).not.toHaveBeenCalled();
    expect(
      useMessageStore().messages.some((m) => m.title === 'Save Successful')
    ).toBe(true);
  });
});
