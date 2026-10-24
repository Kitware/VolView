// @vitest-environment node
import { once } from 'node:events';
import { createServer, IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Context } from '@netlify/edge-functions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import visits from '../netlify/edge-functions/visits';

describe('Netlify visit analytics', () => {
  const ip = '192.0.2.42';
  const token = 'test-token';
  let env: Record<string, string>;
  let pending: Promise<unknown>[];
  let server: ReturnType<typeof createServer> | undefined;

  const request = () =>
    new Request(
      'https://volview.kitware.app/?urls=private-dataset#private-state',
      {
        headers: {
          'User-Agent': 'test-browser',
          Referer:
            'https://example.com/viewer?token=private-token#private-state',
        },
      }
    );

  const context = {
    ip,
    waitUntil: (task: Promise<unknown>) => {
      pending.push(task);
    },
  } as Context;

  async function startEndpoint() {
    const received = Promise.withResolvers<{
      method?: string;
      url?: string;
      headers: IncomingHttpHeaders;
      body: unknown;
      response: ServerResponse;
    }>();
    server = createServer(async (req, response) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.resolve({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        response,
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    env.GOATCOUNTER_SITE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return received;
  }

  beforeEach(() => {
    env = {
      GOATCOUNTER_SITE: 'https://goatcounter.invalid',
      GOATCOUNTER_API_TOKEN: token,
    };
    pending = [];
    vi.stubGlobal('Netlify', { env: { get: (key: string) => env[key] } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    await Promise.all(pending);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends an authenticated pageview after allowing the page to continue', async () => {
    const received = await startEndpoint();
    expect(visits(request(), context)).toBeUndefined();
    const { response, ...sent } = await received.promise;

    expect(sent).toMatchObject({
      method: 'POST',
      url: '/api/v0/count',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: {
        hits: [
          {
            path: 'volview.kitware.app/',
            title: 'VolView',
            ref: 'https://example.com/viewer',
            user_agent: 'test-browser',
            ip,
          },
        ],
      },
    });
    expect(JSON.stringify(sent.body)).not.toContain('private-');
    expect(console.info).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);

    response.writeHead(202).end();
    await Promise.all(pending);
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      'GoatCounter visit accepted (HTTP 202).'
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 429, 503])(
    'reports HTTP %i without logging the response body',
    async (status) => {
      const received = await startEndpoint();
      visits(request(), context);
      const { response } = await received.promise;
      response.writeHead(status).end(`${token} ${ip} private-dataset`);
      await Promise.all(pending);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        `GoatCounter request rejected (HTTP ${status}).`
      );
      expect(console.info).not.toHaveBeenCalled();
    }
  );

  it('distinguishes an ignored IP from an accepted pageview', async () => {
    const received = await startEndpoint();
    visits(request(), context);
    const { response } = await received.promise;
    response.writeHead(202, { 'X-Goatcounter-Filter': '0' }).end();
    await Promise.all(pending);
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      'GoatCounter visit filtered (HTTP 202).'
    );
  });

  it('contains network failures in the background task', async () => {
    const received = await startEndpoint();
    visits(request(), context);
    const { response } = await received.promise;
    response.destroy();
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'GoatCounter request failed. Check configuration and network.'
    );
  });

  it.each(['GOATCOUNTER_SITE', 'GOATCOUNTER_API_TOKEN'])(
    'skips tracking when %s is unset',
    (key) => {
      delete env[key];
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      expect(visits(request(), context)).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
      if (key === 'GOATCOUNTER_API_TOKEN') {
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(
          'GoatCounter disabled: GOATCOUNTER_API_TOKEN is not set.'
        );
      } else {
        expect(console.warn).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['HEAD', 'POST'])('does not count %s requests', (method) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    visits(new Request(request(), { method }), context);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('contains invalid configuration without interrupting the page', async () => {
    env.GOATCOUNTER_SITE = 'invalid URL';
    expect(visits(request(), context)).toBeUndefined();
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      'GoatCounter request failed. Check configuration and network.'
    );
  });
});
