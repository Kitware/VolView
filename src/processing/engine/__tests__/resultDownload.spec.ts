import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteGlobalHeader, setGlobalHeader } from '@/src/utils/fetch';
import { fetchProcessingResult } from '../resultDownload';

describe('fetchProcessingResult', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    setGlobalHeader('Authorization', 'Bearer result-token');
  });

  afterEach(() => {
    deleteGlobalHeader('Authorization');
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it('downloads through the authenticated fetch primitive', async () => {
    fetchSpy.mockResolvedValue(
      new Response(new Blob(['result bytes'], { type: 'application/test' }), {
        status: 200,
      })
    );

    const file = await fetchProcessingResult({
      id: 'output',
      name: 'output.bin',
      url: 'https://results.example/output',
    });

    const [, init] = fetchSpy.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer result-token'
    );
    expect(init).toMatchObject({
      credentials: 'same-origin',
    });
    expect(init.redirect).toBeUndefined();
    expect(file.name).toBe('output.bin');
    expect(await file.text()).toBe('result bytes');
  });

  it('rejects a failed result response instead of saving its error body', async () => {
    fetchSpy.mockResolvedValue(
      new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(
      fetchProcessingResult({
        id: 'output',
        name: 'output.bin',
        url: 'https://results.example/output',
      })
    ).rejects.toThrow('401 Unauthorized');
  });
});
