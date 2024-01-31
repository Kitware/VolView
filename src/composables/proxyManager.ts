import { inject } from 'vue';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';

export const PROXYMANAGER_INJECT_KEY = Symbol('ProxyManager');

/**
 * Injects a provided proxy manager instance if available.
 */
export function useProxyManager(): vtkProxyManager | undefined {
  return inject<vtkProxyManager>(PROXYMANAGER_INJECT_KEY);
}

/**
 * Injects a provided proxy manager instance.
 *
 * Throws an error if no proxy manager is available.
 */
export function requireProxyManager() {
  const pxm = useProxyManager();
  if (!pxm) throw new Error('No proxy manager provided');
  return pxm;
}
