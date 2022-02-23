import { inject } from '@vue/composition-api';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';

const defaultKey = 'ProxyManager';

export function withProxyManager(cb: (pxm: vtkProxyManager) => void) {
  const pxm = inject<vtkProxyManager>('ProxyManager');
  return pxm ? cb(pxm) : null;
}

export function useProxyManager(key = defaultKey) {
  return inject<vtkProxyManager>(key ?? defaultKey);
}
