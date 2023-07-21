// This file runs in the Deno runtime

// @ts-ignore
// eslint-disable-next-line import/no-unresolved
import { Context } from 'https://edge.netlify.com';

export default async (request: Request, context: Context) => {
  let url = 'https://volview.goatcounter.com/count?p=%2F&t=VolView';
  const headers = { 'X-Forwarded-For': context.ip };

  if (request.headers.has('Referer')) {
    url += `&r=${encodeURIComponent(request.headers.get('Referer') ?? '')}`;
  }

  if (request.headers.has('User-Agent')) {
    headers['User-Agent'] = request.headers.get('User-Agent') ?? 'Unknown';
  }

  // don't block the request
  fetch(url, { headers });
};

export const config = { path: '/' };
