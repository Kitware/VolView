import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { $fetch, setGlobalHeader, deleteGlobalHeader } from '@/src/utils/fetch';
import { RequestPool } from '@/src/core/streaming/requestPool';

describe('$fetch global-header merging', () => {
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

  const capturedHeaders = (call = 0): Headers =>
    new Headers((fetchStub.mock.calls[call][1] as RequestInit).headers);

  const sameOrigin = (path: string) => `${window.location.origin}${path}`;

  it('attaches the global bearer to a same-origin request', async () => {
    await $fetch(sameOrigin('/api/x'));
    expect(capturedHeaders().get('Authorization')).toBe('Bearer global');
  });

  it('attaches the global bearer to a cross-origin request (token=/tokenUrl= deployments)', async () => {
    // Hosted instances point urls=/save= at other origins and authenticate
    // them with the launch token — the bearer rides on every request.
    await $fetch('https://data.example/volume');
    expect(capturedHeaders().get('Authorization')).toBe('Bearer global');
  });

  it('keeps both Authorization and Range on a streaming request', async () => {
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
