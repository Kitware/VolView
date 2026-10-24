/* global Netlify */
import type { Context } from '@netlify/edge-functions';

function getReferrer(request: Request) {
  const referrer = request.headers.get('Referer');
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

async function countVisit(
  request: Request,
  ip: string,
  site: string,
  token: string
) {
  try {
    const requestUrl = new URL(request.url);
    const response = await fetch(new URL('/api/v0/count', site), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        hits: [
          {
            path: `${requestUrl.host}${requestUrl.pathname}`,
            title: 'VolView',
            ref: getReferrer(request),
            user_agent: request.headers.get('User-Agent') || 'Unknown',
            ip,
          },
        ],
      }),
    });
    await response.body?.cancel();

    if (response.status !== 202) {
      console.error(`GoatCounter request rejected (HTTP ${response.status}).`);
    } else if (response.headers.has('X-Goatcounter-Filter')) {
      console.info('GoatCounter visit filtered (HTTP 202).');
    } else {
      console.info('GoatCounter visit accepted (HTTP 202).');
    }
  } catch {
    // Errors and response bodies may contain visitor data or credentials.
    console.error(
      'GoatCounter request failed. Check configuration and network.'
    );
  }
}

export default (request: Request, context: Context) => {
  if (request.method !== 'GET') return;

  const site = Netlify.env.get('GOATCOUNTER_SITE');
  if (!site) return;

  const token = Netlify.env.get('GOATCOUNTER_API_TOKEN');
  if (!token) {
    console.warn('GoatCounter disabled: GOATCOUNTER_API_TOKEN is not set.');
    return;
  }

  context.waitUntil(countVisit(request, context.ip, site, token));
};

export const config = { path: '/' };
