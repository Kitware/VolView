import { inject } from 'vue';
import ProxyManagerWrapper from '@/src/core/proxies';

export const PROXY_MANAGER_WRAPPER_INJECT_KEY = Symbol('ProxyManagerWrapper');

/**
 * Injects a provided ProxyManagerWrapper instance if available.
 */
export function useProxyManagerWrapper() {
  return inject<ProxyManagerWrapper>(PROXY_MANAGER_WRAPPER_INJECT_KEY);
}

/**
 * Injects a provided ProxyManagerWrapper instance.
 *
 * Throws an error if none is available.
 */
export function requireProxyManagerWrapper() {
  const pxm = useProxyManagerWrapper();
  if (!pxm) throw new Error('No ProxyManagerWrapper provided');
  return pxm;
}

/**
 * Obtains the underlying vtkProxyManager.
 */
export function useProxyManager() {
  return useProxyManagerWrapper()?.proxyManager;
}

/**
 * Obtains the underlying vtkProxyManager.
 *
 * Throws an error if none is available.
 */
export function requireProxyManager() {
  const pxm = useProxyManager();
  if (!pxm) throw new Error('No ProxyManager provided');
  return pxm;
}
