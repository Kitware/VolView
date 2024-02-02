import { captureMessage } from '@sentry/vue';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';
import { useEventListener, useThrottleFn } from '@vueuse/core';
import { Maybe } from '@/src/types';
import { useProxyManager } from '@/src/composables/useProxyManager';
import { Messages } from '../constants';
import { useMessageStore } from '../store/messages';
import { onProxyManagerEvent } from './onProxyManagerEvent';

/**
 * Collects relevant context for debugging 3D crashes.
 * @returns
 */
function getVolumeMapperContext(pxm: Maybe<vtkProxyManager>) {
  if (!pxm) return null;

  const view3d = pxm.getViews().find((view) => view.isA('vtkLPSView3DProxy'));
  if (!view3d) return null;

  const ren = view3d.getRenderer();
  const vol = ren.getVolumes()[0];
  if (!vol) return null;

  const mapper = vol.getMapper();
  if (!mapper) return null;

  return mapper.get(
    'computeNormalFromOpacity',
    'autoAdjustSampleDistances',
    'maximumSamplesPerRay',
    'sampleDistance',
    'volumetricScatteringBlending'
  );
}

export function useWebGLWatchdog() {
  const watchdogs = new Map<string, () => void>();
  const pxm = useProxyManager();

  const reportError = useThrottleFn(() => {
    const messageStore = useMessageStore();
    messageStore.addError(Messages.WebGLLost.title, Messages.WebGLLost.details);
    captureMessage('WebGL2 context was lost', {
      contexts: {
        vtk: {
          volumeMapper: getVolumeMapperContext(pxm),
        },
      },
    });
  }, 150);

  onProxyManagerEvent('ProxyCreated', (id, obj) => {
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

  onProxyManagerEvent('ProxyDeleted', (id) => {
    if (watchdogs.has(id)) {
      watchdogs.get(id)!();
      watchdogs.delete(id);
    }
  });
}
