import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { populateAuthorizationToken } from '@/src/utils/token';
import { globalHeaders, deleteGlobalHeader } from '@/src/utils/fetch';

describe('populateAuthorizationToken', () => {
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    deleteGlobalHeader('Authorization');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const bearer = () => globalHeaders.get('Authorization');

  it('sets the bearer synchronously from token=', async () => {
    const urlParams = { token: 'abc' };

    await populateAuthorizationToken(urlParams);

    expect(bearer()).toBe('Bearer abc');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  // Regression: the 2xx check was `status % 100 !== 2`, which takes the last
  // two digits — it rejected every ordinary 200 and accepted 202/302/502.
  it.each([200, 201, 204])('accepts a %i token response', async (status) => {
    const urlParams = {
      tokenUrl: 'https://example.com/userToken',
    };
    fetchStub.mockResolvedValue(new Response('tok', { status }));

    await populateAuthorizationToken(urlParams);

    expect(bearer()).toBe('Bearer tok');
  });

  it.each([302, 404, 502])('rejects a %i token response', async (status) => {
    const urlParams = {
      tokenUrl: 'https://example.com/userToken',
    };
    fetchStub.mockResolvedValue(new Response('nope', { status }));

    await populateAuthorizationToken(urlParams);

    expect(bearer()).toBeNull();
  });

  it('resolves only after the tokenUrl bearer is set', async () => {
    // The caller awaits this before loading, so the first data request carries
    // the header rather than racing an un-awaited fetch.
    const urlParams = {
      tokenUrl: 'https://example.com/userToken',
    };
    let release: (r: Response) => void = () => {};
    fetchStub.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const pending = populateAuthorizationToken(urlParams);
    expect(bearer()).toBeNull();

    release(new Response('late', { status: 200 }));
    await pending;

    expect(bearer()).toBe('Bearer late');
  });

  it('uses tokenUrlMethod when given', async () => {
    const urlParams = {
      tokenUrl: 'https://example.com/userToken',
      tokenUrlMethod: 'POST',
    };
    fetchStub.mockResolvedValue(new Response('tok', { status: 200 }));

    await populateAuthorizationToken(urlParams);

    expect(fetchStub).toHaveBeenCalledWith('https://example.com/userToken', {
      method: 'POST',
    });
  });

  it('continues without a bearer when the token fetch fails', async () => {
    const urlParams = {
      tokenUrl: 'https://example.com/userToken',
    };
    fetchStub.mockRejectedValue(new Error('network down'));

    await expect(
      populateAuthorizationToken(urlParams)
    ).resolves.toBeUndefined();

    expect(bearer()).toBeNull();
  });
});
