import type { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { VtkProxy } from '@kitware/vtk.js/macros';
import { onBeforeUnmount } from 'vue';
import { requireProxyManager } from './useProxyManager';

export type ProxyManagerEvent =
  | 'ProxyCreated'
  | 'ProxyModified'
  | 'ProxyDeleted'
  | 'ProxyRegistrationChange';

export function onProxyManagerEvent(
  event: ProxyManagerEvent,
  cb: (
    proxyID: string,
    obj: VtkProxy | null,
    action: 'register' | 'unregister' | 'modified'
  ) => void
) {
  const subs: vtkSubscription[] = [];
  const proxyManager = requireProxyManager();

  const proxySubs: Record<string, vtkSubscription> = Object.create(null);

  subs.push(
    proxyManager.onProxyRegistrationChange((info) => {
      const { action, proxyId, proxy } = info;
      if (action === 'register') {
        if (event === 'ProxyCreated') {
          cb(proxyId, proxy, 'register');
        }
        if (event === 'ProxyModified') {
          proxySubs[proxyId] = proxy.onModified(() =>
            cb(proxyId, proxy, 'modified')
          );
        }
      } else if (action === 'unregister') {
        if (proxyId in proxySubs) {
          proxySubs[proxyId].unsubscribe();
          delete proxySubs[proxyId];
        }
        if (event === 'ProxyDeleted') {
          cb(proxyId, null, 'unregister');
        }
      }
      if (event === 'ProxyRegistrationChange') {
        cb(proxyId, proxy, action);
      }
    })
  );

  onBeforeUnmount(() => {
    while (subs.length) {
      subs.pop()!.unsubscribe();
    }
    Object.entries(proxySubs).forEach(([id, sub]) => {
      sub.unsubscribe();
      delete proxySubs[id];
    });
  });
}
