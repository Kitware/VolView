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

  it('accepts a relative save URL (it resolves same-origin)', () => {
    const store = useRemoteSaveStateStore();

    store.setSaveUrl('/api/v1/item/abc/volview');

    expect(store.saveUrl).toBe('/api/v1/item/abc/volview');
  });

  it('refuses a cross-origin save URL and never POSTs the session to it', async () => {
    // A crafted ?save=https://attacker.example/ would otherwise exfiltrate the
    // whole serialized session (plus any bearer $fetch attaches).
    const store = useRemoteSaveStateStore();

    store.setSaveUrl('https://attacker.example/collect');

    // Empty target inerts the save UI, which is gated on a non-empty saveUrl.
    expect(store.saveUrl).toBe('');
    await store.saveState();
    expect($fetch).not.toHaveBeenCalled();
    expect(
      useMessageStore().messages.some((m) => m.title === 'Save Disabled')
    ).toBe(true);
  });

  // A protocol-relative URL is the easy way to miss a naive `startsWith('http')`
  // style check; javascript:/data: resolve to a null origin; a malformed URL
  // fails to parse at all. All are off-origin and must be refused.
  it.each([
    ['//evil.example/collect', 'protocol-relative'],
    ['javascript:alert(1)', 'null origin'],
    ['data:text/plain,x', 'null origin'],
    ['http://', 'unparseable'],
  ])('refuses %s (%s)', (url) => {
    const store = useRemoteSaveStateStore();

    store.setSaveUrl(url);

    expect(store.saveUrl).toBe('');
  });
});

// A successful save repoints ONLY the tab's `urls=` at the returned
// `resumeUrl` so a future F5 reloads the save — no reload, and `save=`, the
// in-memory save target, and `config=` are all untouched. No `resumeUrl` (or
// an unparseable body) leaves the tab as-is.
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

    expect(vi.mocked($fetch)).toHaveBeenCalledWith(
      launchSaveUrl,
      expect.objectContaining({ method: 'POST' })
    );
    expect(vi.mocked($fetch).mock.calls[0][1]?.redirect).toBeUndefined();
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
