import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
import { computed, ref, Ref, unref, watch } from '@vue/composition-api';
import { MaybeRef } from '@vueuse/core';
import { ViewProxyType } from '../core/proxies';
import { useViewStore } from '../store/views';

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
  });

  return {
    viewProxy,
    setContainer,
  };
}
