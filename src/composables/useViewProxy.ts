import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, ref, Ref, unref, watch } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';
import { ViewProxyType } from '../core/proxies';
import { useViewStore } from '../store/views';
import { useVTKCallback } from './useVTKCallback';

export function useViewProxy<T extends vtkViewProxy = vtkViewProxy>(
  id: Ref<string>,
  type: MaybeRef<ViewProxyType>
) {
  const viewStore = useViewStore();

  const container = ref<HTMLElement | null>(null);

  const setContainer = (el: HTMLElement | null | undefined) => {
    container.value = el ?? null;
  };

  const viewProxy = computed<T>(() =>
    viewStore.createOrGetViewProxy(id.value, unref(type))
  );

  watch(viewProxy, (curViewProxy, oldViewProxy) => {
    oldViewProxy.setContainer(null);
    curViewProxy.setContainer(container.value);
  });

  watch(container, (curContainer) => {
    viewProxy.value.setContainer(curContainer);
    // setContainer doesn't call modified
    viewProxy.value.modified();
  });

  return {
    viewProxy,
    setContainer,
  };
}

function onViewProxyModified<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<T>,
  callback: () => void
) {
  const onModified = useVTKCallback(
    computed(() => unref(viewProxy).onModified)
  );
  onModified(callback);
}

export function useViewProxyMounted<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<T>,
  callback: () => void
) {
  const mounted = ref(false);

  onViewProxyModified(viewProxy, () => {
    mounted.value = !!unref(viewProxy).getContainer();
  });

  watch(
    mounted,
    (m) => {
      if (m) callback();
    },
    { immediate: true }
  );
}

export function useViewProxyUnmounted<T extends vtkViewProxy = vtkViewProxy>(
  viewProxy: MaybeRef<T>,
  callback: () => void
) {
  const mounted = ref(false);

  onViewProxyModified(viewProxy, () => {
    mounted.value = !!unref(viewProxy).getContainer();
  });

  watch(
    mounted,
    (m, prev) => {
      if (prev && !m) callback();
    },
    { immediate: true }
  );
}
