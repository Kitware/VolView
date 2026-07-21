// One gate for all configured egress: the remote-save target passes the SAME
// runtime origin gate as processing providers. A cross-origin target never
// reaches `saveUrl`, so the surface (gated on `saveUrl !== ''`) and its egress
// both stay inert.

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

describe('remote save passes the shared origin gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked($fetch).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a same-origin save URL with zero config', () => {
    const store = useRemoteSaveStateStore();
    const url = `${window.location.origin}/api/session/save`;

    store.setSaveUrl(url);

    expect(store.saveUrl).toBe(url);
  });

  it('refuses a cross-origin save URL', () => {
    const store = useRemoteSaveStateStore();

    store.setSaveUrl('https://attacker.example/save');

    expect(store.saveUrl).toBe('');
    expect(
      useMessageStore().messages.some(
        (message) => message.title === 'Remote save unavailable'
      )
    ).toBe(true);
  });

  it('performs no egress to a refused save target', async () => {
    const store = useRemoteSaveStateStore();

    store.setSaveUrl('https://attacker.example/save');
    await store.saveState();

    expect($fetch).not.toHaveBeenCalled();
  });
});

// On a successful save the backend returns a single
// `resumeUrl`; the client repoints BOTH the tab's `urls=` (a future F5 reloads
// the save) AND `save=` (subsequent saves go item-scoped into the same session
// item) at it, and re-targets its in-memory save URL — no reload, `config=`
// untouched. A response without `resumeUrl` (or an unparseable body) leaves the
// tab as-is.
describe('resume repoint on save', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked($fetch).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('repoints urls= AND save= to the resumeUrl and re-targets the save url (config= untouched)', async () => {
    const resumeUrl = '/api/v1/item/session-123/volview';
    vi.mocked($fetch).mockResolvedValue(
      new Response(JSON.stringify({ resumeUrl }), { status: 200 })
    );
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    const store = useRemoteSaveStateStore();
    store.setSaveUrl(`${window.location.origin}/api/session/save`);

    await store.saveState();

    expect(replace).toHaveBeenCalledTimes(1);
    const nextUrl = new URL(replace.mock.calls[0][2] as string);
    expect(nextUrl.searchParams.get('urls')).toBe(resumeUrl);
    expect(nextUrl.searchParams.get('save')).toBe(resumeUrl);
    // Subsequent in-session saves now target the same session item.
    expect(store.saveUrl).toBe(resumeUrl);
    expect(
      useMessageStore().messages.some((m) => m.title === 'Save Successful')
    ).toBe(true);
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

  it('leaves the tab and save url as-is when the resumeUrl is cross-origin (fail-safe no-op)', async () => {
    // A same-origin save succeeds, but the backend hands back a cross-origin
    // resumeUrl. The repoint (urls=/save= stamp + in-memory re-target) is gated
    // on the SAME origin gate as setSaveUrl, so it must be a fail-safe no-op:
    // the ordinary save still succeeds, but nothing is repointed off-origin.
    const saveUrl = `${window.location.origin}/api/session/save`;
    const resumeUrl = 'https://evil.example.com/api/v1/item/x/volview';
    vi.mocked($fetch).mockResolvedValue(
      new Response(JSON.stringify({ resumeUrl }), { status: 200 })
    );
    const replace = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => {});
    const store = useRemoteSaveStateStore();
    store.setSaveUrl(saveUrl);

    await store.saveState();

    // (d) address bar never stamped at the cross-origin resumeUrl.
    expect(replace).not.toHaveBeenCalled();
    // (c) in-memory save url unchanged — still the original same-origin item,
    // not '' and not the cross-origin resumeUrl.
    expect(store.saveUrl).toBe(saveUrl);
    // (a) the ordinary save still succeeded.
    expect(
      useMessageStore().messages.some((m) => m.title === 'Save Successful')
    ).toBe(true);
    // (b) no persistent 'Remote save unavailable' warning surfaced.
    expect(
      useMessageStore().messages.some(
        (m) => m.title === 'Remote save unavailable'
      )
    ).toBe(false);
  });
});
