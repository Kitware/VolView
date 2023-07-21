// This file runs in the Deno runtime

// @ts-ignore
// eslint-disable-next-line import/no-unresolved
import { Context } from 'https://edge.netlify.com';

// @ts-ignore
const GOATCOUNTER_SITE = Deno.env.get('GOATCOUNTER_SITE');

export default async (request: Request, context: Context) => {
  if (!GOATCOUNTER_SITE) return;

  const headers = { 'X-Forwarded-For': context.ip };
  const url = new URL(GOATCOUNTER_SITE);
  const { searchParams } = url;

  url.pathname = '/count';

  const requestUrl = new URL(request.url);
  searchParams.set('p', `${requestUrl.host}${requestUrl.pathname}`);
  searchParams.set('t', 'VolView');

  if (request.headers.has('Referer')) {
    searchParams.set(
      'r',
      encodeURIComponent(request.headers.get('Referer') ?? '')
    );
  }

  if (request.headers.has('User-Agent')) {
    headers['User-Agent'] = request.headers.get('User-Agent') ?? 'Unknown';
  }

  // don't block the request
  fetch(url.toString(), { headers });
};

export const config = { path: '/' };
