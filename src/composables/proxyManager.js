import { inject } from '@vue/composition-api';

const defaultKey = 'ProxyManager';

export function withProxyManager(cb) {
  const pxm = inject('ProxyManager');
  return pxm ? cb(pxm) : null;
}

export function useProxyManager(key = defaultKey) {
  return inject(key ?? defaultKey);
}
