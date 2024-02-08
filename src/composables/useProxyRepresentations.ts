import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { vtkLPSViewProxy } from '@/src/types/vtk-types';
import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import { MaybeRef, computed, unref, watchPostEffect } from 'vue';

export function useProxyRepresentations<
  T extends vtkAbstractRepresentationProxy = vtkAbstractRepresentationProxy
>(dataIDs: MaybeRef<Maybe<Array<Maybe<string>>>>, viewID: MaybeRef<string>) {
  const viewStore = useViewStore();
  const viewProxy = computed(() =>
    viewStore.getViewProxy<vtkLPSViewProxy>(unref(viewID))
  );

  const representations = computed(() => {
    const viewIdVal = unref(viewID);
    return (unref(dataIDs) ?? [])
      .filter((id): id is string => !!id)
      .map((id) => {
        return viewStore.getDataRepresentationForView<T>(id, viewIdVal);
      })
      .filter((rep): rep is T => !!rep);
  });

  // Wait for the component to have mounted with PostEffect.
  // When changing layouts, it's possible for the new component instance to
  // execute effects prior to the old component running onCleanup callbacks.
  watchPostEffect((onCleanup) => {
    const view = viewProxy.value;
    if (!view) return;

    const reps = representations.value;
    if (!reps.length) return;

    reps.forEach((rep) => {
      view.addRepresentation(rep);
    });
    view.getRenderer().computeVisiblePropBounds();
    view.renderLater();

    onCleanup(() => {
      reps.forEach((rep) => {
        view.removeRepresentation(rep);
      });
    });
  });

  return { representations };
}

export function useProxyRepresentation<
  T extends vtkAbstractRepresentationProxy = vtkAbstractRepresentationProxy
>(dataID: MaybeRef<Maybe<string>>, viewID: MaybeRef<string>) {
  const ids = computed(() => [unref(dataID)]);
  const { representations } = useProxyRepresentations<T>(ids, viewID);
  const representation = computed<Maybe<T>>(
    () => representations.value[0] ?? null
  );
  return { representation };
}
