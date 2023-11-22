import { captureException, captureMessage } from '@sentry/vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { useEventListener, useThrottleFn } from '@vueuse/core';
import { Messages } from '../constants';
import { useMessageStore } from '../store/messages';
import { onProxyManagerEvent, ProxyManagerEvent } from './onProxyManagerEvent';

export function useWebGLWatchdog() {
  const watchdogs = new Map<string, () => void>();

  const reportError = useThrottleFn((event) => {
    const messageStore = useMessageStore();
    messageStore.addError(Messages.WebGLLost.title, Messages.WebGLLost.details);
    if (event) {
      captureException(event);
    } else {
      captureMessage('WebGL2 context was lost');
    }
  }, 100);

  onProxyManagerEvent(ProxyManagerEvent.ProxyCreated, (id, obj) => {
    if (!obj || !obj.isA('vtkViewProxy')) return;
    const view = obj as vtkViewProxy;
    // TODO getCanvas() typing
    const canvas = view
      .getRenderWindow()
      .getViews()[0]
      .getCanvas() as HTMLCanvasElement;

    const cleanup = useEventListener(canvas, 'webglcontextlost', reportError);
    watchdogs.set(id, cleanup);
  });

  onProxyManagerEvent(ProxyManagerEvent.ProxyDeleted, (id) => {
    if (watchdogs.has(id)) {
      watchdogs.get(id)!();
      watchdogs.delete(id);
    }
  });
}
