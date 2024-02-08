import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, onUnmounted, ref, unref, watch, watchEffect } from 'vue';
import { MaybeRef, useElementSize } from '@vueuse/core';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { Maybe } from '@/src/types';
import { ViewProxyType } from '../core/proxies';
import { useViewStore } from '../store/views';

export function useViewProxy<T extends vtkViewProxy = vtkViewProxy>(
  id: MaybeRef<string>,
  type: MaybeRef<ViewProxyType>
) {
  const viewStore = useViewStore();

  const viewProxy = computed<T>(() =>
    viewStore.createOrGetViewProxy(unref(id), unref(type))
  );

  return {
    viewProxy,
  };
}

function isViewProxyMounted<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<Maybe<T>>
) {
  const mounted = ref(false);

  const container = ref<Maybe<HTMLElement>>(unref(viewProxy)?.getContainer());
  onVTKEvent<vtkViewProxy, 'onModified'>(viewProxy, 'onModified', () => {
    container.value = unref(viewProxy)?.getContainer();
  });

  const { width, height } = useElementSize(container);

  const updateMounted = () => {
    // view is considered mounted when the container has a non-zero size
    mounted.value = !!(width.value && height.value);
  };

  watchEffect(() => updateMounted());

  return mounted;
}

export function onViewProxyMounted<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<Maybe<T>>,
  callback: () => void
) {
  const mounted = isViewProxyMounted(viewProxy);

  watch(
    mounted,
    (m) => {
      if (m) callback();
    },
    { immediate: true }
  );
}

export function onViewProxyUnmounted<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<Maybe<T>>,
  callback: () => void
) {
  const mounted = isViewProxyMounted(viewProxy);
  let invoked = false;
  const invokeCallback = () => {
    if (invoked) return;
    callback();
    invoked = true;
  };

  onUnmounted(() => invokeCallback());

  watch(
    mounted,
    (m, prev) => {
      if (prev && !m) invokeCallback();
    },
    { immediate: true }
  );
}
