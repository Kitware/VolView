import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { usePersistCameraConfig } from '@/src/composables/usePersistCameraConfig';
import useViewCameraStore from '@/src/store/view-configs/camera';

describe('usePersistCameraConfig', () => {
  let scope: EffectScope;
  beforeEach(() => {
    setActivePinia(createPinia());
    scope = effectScope(true);
  });
  afterEach(() => scope.stop());

  // Camera changes reach the saved config on the next task.
  const settle = async () => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve));
  };

  const setup = () => {
    const camera = vtkCamera.newInstance();
    const imageId = ref('a');
    scope.run(() => usePersistCameraConfig('view', imageId, camera));
    // Stands in for the view fitting its camera to a newly shown image.
    const show = async (id: string, fittedScale: number) => {
      imageId.value = id;
      const cameras = useViewCameraStore();
      if (!cameras.isCameraInitialized('view', id)) {
        camera.setParallelScale(fittedScale);
        cameras.markCameraAsInitialized('view', id);
      }
      await settle();
    };
    return { camera, imageId, show };
  };

  it('returns an image to its own zoom when another fits at the same scale', async () => {
    const { camera, show } = setup();
    await show('a', 16);
    await show('b', 16);

    await show('a', 16);
    camera.setParallelScale(4);
    await settle();
    await show('b', 16);

    expect(camera.getParallelScale()).toBe(16);
  });

  it('does not save the previous camera for an image that is not shown yet', async () => {
    const { camera, imageId, show } = setup();
    await show('a', 4);

    imageId.value = 'b';
    await settle();
    await show('a', 4);
    await show('b', 16);

    expect(camera.getParallelScale()).toBe(16);
  });
});
