import { setGlobalHeader } from '@/src/utils/fetch';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';

export function stripTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const url = new URL(window.location.toString());
  params.delete('token');
  url.search = `?${params.toString()}`;
  window.history.replaceState(null, '', url.toString());
}

// Awaited by the caller before any data request goes out: a `tokenUrl=` token
// that lands after loading has started would leave the first requests
// unauthenticated. A failure is non-fatal — the app continues without a bearer
// and the data requests fail on their own terms.
export async function populateAuthorizationToken() {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

  if (urlParams.token) {
    setGlobalHeader('Authorization', `Bearer ${urlParams.token}`);
  }

  if (urlParams.tokenUrl) {
    try {
      const response = await fetch(String(urlParams.tokenUrl), {
        method: String(urlParams.tokenUrlMethod || 'GET'),
      });
      if (!response.ok) {
        throw new Error(`received ${response.status} response`);
      }
      setGlobalHeader('Authorization', `Bearer ${await response.text()}`);
    } catch (err) {
      console.error('error while fetching token from tokenUrl:', err);
    }
  }
}
