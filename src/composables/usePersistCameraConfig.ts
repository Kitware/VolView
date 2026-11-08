import { MaybeRef, Ref, computed, unref, watch } from 'vue';
import { Maybe } from '@/src/types';
import useViewCameraStore from '@/src/store/view-configs/camera';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import { vtkFieldRef } from '@/src/core/vtk/vtkFieldRef';
import { syncRef } from '@vueuse/core';
import { guardedWritableRef } from '@/src/utils/guardedWritableRef';

export function usePersistCameraConfig(
  viewID: MaybeRef<string>,
  dataID: MaybeRef<Maybe<string>>,
  camera: MaybeRef<vtkCamera>
) {
  const viewCameraStore = useViewCameraStore();

  const keys = [
    'position',
    'focalPoint',
    'viewUp',
    'parallelScale',
    'directionOfProjection',
  ] as const;
  type KeyType = (typeof keys)[number];

  const cameraRefs = keys.reduce(
    (refs, key) => ({
      ...refs,
      [key]: guardedWritableRef(
        vtkFieldRef(camera, key),
        (incoming) => !!incoming
      ),
    }),
    {} as Record<KeyType, Ref<any>>
  );

  const config = computed(() =>
    viewCameraStore.getConfig(unref(viewID), unref(dataID))
  );

  const configRefs = keys.reduce(
    (refs, key) => ({
      ...refs,
      [key]: computed({
        get: () => config.value?.[key],
        set: (v) => {
          const viewIDVal = unref(viewID);
          const dataIDVal = unref(dataID);
          if (!viewIDVal || !dataIDVal) return;
          viewCameraStore.updateConfig(viewIDVal, dataIDVal, {
            [key]: v,
          });
          if (viewCameraStore.isSync()) {
            viewCameraStore.updateSyncConfigs();
          }
        },
      }),
    }),
    {} as Record<KeyType, Ref<any>>
  );

  // Until the view fits an image, the camera still shows the previous one.
  const cameraShowsImage = () =>
    viewCameraStore.disableCameraAutoReset ||
    viewCameraStore.isCameraInitialized(unref(viewID), unref(dataID));

  // Rebind so an unchanged camera value is also saved for the new image.
  watch(
    [() => unref(viewID), () => unref(dataID), cameraShowsImage],
    ([, , showsImage], _previous, onCleanup) => {
      if (!showsImage) return;
      const stop = keys.map((key) => syncRef(configRefs[key], cameraRefs[key]));
      onCleanup(() => stop.forEach((unsubscribe) => unsubscribe()));
    },
    // Sync: the saved camera must land before views reset clipping ranges.
    { immediate: true, flush: 'sync' }
  );
}
