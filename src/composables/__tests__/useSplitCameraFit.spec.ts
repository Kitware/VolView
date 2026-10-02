import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, effectScope, ref, type EffectScope } from 'vue';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { useAutoFitState } from '@/src/composables/useAutoFitState';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import { useViewStore } from '@/src/store/views';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useViewCameraStore } from '@/src/store/view-configs/camera';

describe('split camera fit mode', () => {
  const scopes: EffectScope[] = [];
  beforeEach(() => {
    setActivePinia(createPinia());
    useViewConfigStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    vi.useRealTimers();
  });

  const createCamera = (viewID: string, dataID = ref('image')) => {
    const store = useViewCameraStore();
    const camera = vtkCamera.newInstance();
    const scope = effectScope();
    scopes.push(scope);
    const fit = scope.run(() => {
      const enabled = computed({
        get: () => store.getConfig(viewID, dataID.value)?.autoFit ?? true,
        set: (value: boolean) =>
          store.updateConfig(viewID, dataID.value, { autoFit: value }),
      });
      const autoFit = useAutoFitState(camera, enabled);
      usePersistCameraConfig(viewID, dataID, camera);
      return autoFit;
    })!;
    return { camera, fit };
  };

  it('tracks fit mode by dataset and clears it on close, image deletion, and restore', () => {
    const views = useViewStore();
    const cameras = useViewCameraStore();
    const source = views.layoutViews[0].id;
    cameras.updateConfig(source, 'image', { parallelScale: 14 });
    cameras.updateConfig(source, 'image', { autoFit: false });
    cameras.updateConfig(source, 'other', { autoFit: false });
    const imageID = ref('image');
    const original = createCamera(source, imageID);
    expect(original.fit.autoFit.value).toBe(false);
    imageID.value = 'fresh';
    expect(original.fit.autoFit.value).toBe(true);
    imageID.value = 'other';
    expect(original.fit.autoFit.value).toBe(false);

    const target = views.splitView(source, 'column')!;
    expect(cameras.getConfig(target, 'image')?.autoFit ?? true).toBe(false);
    views.closeView(target);
    expect(cameras.getConfig(target, 'image')?.autoFit ?? true).toBe(true);
    useViewConfigStore().removeData('image');
    expect(cameras.getConfig(source, 'image')?.autoFit ?? true).toBe(true);
    expect(cameras.getConfig(source, 'other')?.autoFit ?? true).toBe(false);
    views.deserializeLayout({
      version: '9.0.0',
      dataSources: [],
      layout: {
        direction: 'column',
        items: [{ type: 'view', viewId: 'restored' }],
      },
      viewByID: {
        restored: {
          id: 'restored',
          name: 'Axial',
          type: '2D',
          dataID: null,
          options: { orientation: 'Axial' },
        },
      },
    });
    expect(cameras.getConfig(source, 'other')?.autoFit ?? true).toBe(true);
  });
});
