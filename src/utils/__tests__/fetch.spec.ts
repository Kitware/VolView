import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  $fetch,
  setGlobalHeader,
  deleteGlobalHeader,
  setBearerScope,
} from '@/src/utils/fetch';
import { RequestPool } from '@/src/core/streaming/requestPool';

describe('$fetch origin-aware authentication', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchStub = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchStub);
    setGlobalHeader('Authorization', 'Bearer global');
  });

  afterEach(() => {
    deleteGlobalHeader('Authorization');
    vi.unstubAllGlobals();
  });

  const capturedInit = (call = 0): RequestInit =>
    fetchStub.mock.calls[call][1] as RequestInit;
  const capturedHeaders = (call = 0): Headers =>
    new Headers(capturedInit(call).headers);

  const sameOrigin = (path: string) => `${window.location.origin}${path}`;

  it('attaches the global bearer to a same-origin request', async () => {
    await $fetch(sameOrigin('/api/x'));
    expect(capturedHeaders().get('Authorization')).toBe('Bearer global');
  });

  it('keeps both Authorization and Range on a same-origin streaming request', async () => {
    await $fetch(sameOrigin('/api/x'), { headers: { Range: 'bytes=10-' } });
    const headers = capturedHeaders();
    expect(headers.get('Authorization')).toBe('Bearer global');
    expect(headers.get('Range')).toBe('bytes=10-');
  });

  it('layers precedence globalHeaders < Request.headers < RequestInit.headers', async () => {
    const request = new Request(sameOrigin('/api/x'), {
      headers: { 'X-Foo': 'from-request', Authorization: 'Bearer request' },
    });
    await $fetch(request, { headers: { 'X-Foo': 'from-init' } });
    const headers = capturedHeaders();
    // RequestInit.headers wins over the Request's own headers.
    expect(headers.get('X-Foo')).toBe('from-init');
    // The Request's Authorization overrides the global bearer.
    expect(headers.get('Authorization')).toBe('Bearer request');
  });

  it('never sends the global Authorization header cross-origin (default same-origin scope)', async () => {
    await $fetch('https://cross-origin.example/data');
    expect(capturedHeaders().has('Authorization')).toBe(false);
    // A cross-origin request keeps native credential behavior (never forced).
    expect(capturedInit().credentials).toBeUndefined();
  });

  it('attaches an explicit token= bearer cross-origin (any-origin scope)', async () => {
    // token= is a secret its author already holds: it rides to any origin, the
    // documented cross-origin hosted-instance flow.
    setBearerScope({ kind: 'any-origin' });
    await $fetch('https://cross-origin.example/data');
    expect(capturedHeaders().get('Authorization')).toBe('Bearer global');
    // Still native credential behavior cross-origin.
    expect(capturedInit().credentials).toBeUndefined();
  });

  it('attaches a tokenUrl-derived bearer only to its issuing origin (and same-origin)', async () => {
    // tokenUrl=-derived token is scoped to the endpoint's own origin so a
    // crafted link cannot exfiltrate a freshly-minted token to a foreign host.
    setBearerScope({ kind: 'origin', origin: 'https://data.example' });

    await $fetch('https://data.example/volume');
    expect(capturedHeaders(0).get('Authorization')).toBe('Bearer global');

    await $fetch('https://attacker.example/volume');
    expect(capturedHeaders(1).has('Authorization')).toBe(false);

    await $fetch(sameOrigin('/api/x'));
    expect(capturedHeaders(2).get('Authorization')).toBe('Bearer global');
  });

  it('defaults same-origin credentials to same-origin and honors a stricter omit', async () => {
    await $fetch(sameOrigin('/a'));
    expect(capturedInit(0).credentials).toBe('same-origin');
    await $fetch(sameOrigin('/b'), { credentials: 'omit' });
    expect(capturedInit(1).credentials).toBe('omit');
  });
});

describe('RequestPool default fetch is the authenticated $fetch', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchStub = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchStub);
    setGlobalHeader('Authorization', 'Bearer pool');
  });

  afterEach(() => {
    deleteGlobalHeader('Authorization');
    vi.unstubAllGlobals();
  });

  it('routes a default-pool request through $fetch so the bearer is attached', async () => {
    // No custom fetchFn: the singleton/default path the streaming importers use.
    const pool = new RequestPool();
    await pool.fetch(`${window.location.origin}/api/stream`);
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer pool');
  });
});
