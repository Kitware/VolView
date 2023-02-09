import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { VtkProxy } from '@kitware/vtk.js/macros';
import { onBeforeUnmount } from '@vue/composition-api';
import { withProxyManager } from './proxyManager';

export enum ProxyManagerEvent {
  ProxyCreated,
  ProxyModified,
  ProxyDeleted,
  ProxyRegistrationChange,
}

export function onProxyManagerEvent(
  event: ProxyManagerEvent,
  cb: (proxyID: string, obj: VtkProxy | null) => void
) {
  const subs: vtkSubscription[] = [];

  withProxyManager((proxyManager) => {
    const proxySubs = Object.create(null);

    subs.push(
      proxyManager.onProxyRegistrationChange((info) => {
        const { action, proxyId, proxy } = info;
        if (action === 'register') {
          if (event === ProxyManagerEvent.ProxyCreated) {
            cb(proxyId, proxy);
          }
          if (event === ProxyManagerEvent.ProxyModified) {
            proxySubs[proxyId] = proxy.onModified(() => cb(proxyId, proxy));
          }
        } else if (action === 'unregister') {
          if (proxyId in proxySubs) {
            proxySubs[proxyId].unsubscribe();
            delete proxySubs[proxyId];
          }
          if (event === ProxyManagerEvent.ProxyDeleted) {
            cb(proxyId, null);
          }
        }
      })
    );
  });

  onBeforeUnmount(() => {
    while (subs.length) {
      subs.pop()!.unsubscribe();
    }
  });
}
