import { setGlobalHeader, setBearerScope } from '@/src/utils/fetch';
import { resolveOrigin } from '@/src/io/originGate';
import vtkURLExtract from '@kitware/vtk.js/Common/Core/URLExtract';
import { UrlParams } from '@vueuse/core';

export function stripTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const url = new URL(window.location.toString());
  params.delete('token');
  url.search = `?${params.toString()}`;
  window.history.replaceState(null, '', url.toString());
}

export function populateAuthorizationToken() {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

  if (urlParams.token) {
    // An explicit token= is a secret its link author already possesses; it may
    // ride to any origin (the documented cross-origin hosted-instance flow).
    setGlobalHeader('Authorization', `Bearer ${urlParams.token}`);
    setBearerScope({ kind: 'any-origin' });
  }

  if (urlParams.tokenUrl) {
    const tokenUrl = String(urlParams.tokenUrl);
    fetch(tokenUrl, {
      method: String(urlParams.tokenUrlMethod || 'GET'),
    })
      .then((response) => {
        if (response.status % 100 !== 2) {
          throw new Error('received non-200 response');
        }
        return response.text();
      })
      .then((text) => {
        setGlobalHeader('Authorization', `Bearer ${text}`);
        // A tokenUrl=-derived token is minted by a (possibly cookie-
        // authenticated) endpoint; scope it to that endpoint's own origin so a
        // crafted link cannot mint the victim's token and exfiltrate it to an
        // attacker host. A malformed/relative tokenUrl falls back to
        // same-origin-only.
        const origin = resolveOrigin(tokenUrl);
        setBearerScope(
          origin ? { kind: 'origin', origin } : { kind: 'same-origin' }
        );
      })
      .catch((err) => {
        console.error('error while fetching token from tokenUrl:', err);
      });
  }
}
