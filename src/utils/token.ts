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

export function populateAuthorizationToken() {
  const urlParams = vtkURLExtract.extractURLParameters() as UrlParams;

  if (urlParams.token) {
    setGlobalHeader('Authorization', `Bearer ${urlParams.token}`);
  }

  if (urlParams.tokenUrl) {
    fetch(String(urlParams.tokenUrl), {
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
      })
      .catch((err) => {
        console.error('error while fetching token from tokenUrl:', err);
      });
  }
}
