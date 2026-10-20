import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { ViewInfo } from '@/src/types/views';

export function useSyncWindowing() {
  const windowingStore = useWindowingStore();
  const viewStore = useViewStore();
  let isUpdating = false;
  const isSourceView = (view: Maybe<ViewInfo>) =>
    view != null && view.type !== 'EnFace';
  const getLiveSourceView = (id: string) => {
    const source = viewStore.getView(id);
    if (source) return isSourceView(source) ? source : null;
    const owner = viewStore.getView(windowingStore.getViewOwner(id));
    return owner?.type === 'Oblique' ? owner : null;
  };
  const findBoundSourcePeer = (viewID: string, dataID: string) =>
    viewStore
      .getAllViews()
      .find(
        (view) =>
          view.id !== viewID && isSourceView(view) && view.dataID === dataID
      );

  windowingStore.WindowingUpdateEvent.on((viewID, dataID) => {
    const sourceView = getLiveSourceView(viewID);
    // Each projection method and slab has its own intensity distribution.
    if (isUpdating || !sourceView) return;
    isUpdating = true;
    try {
      const config = windowingStore.getConfig(viewID, dataID);
      viewStore.viewIDs
        .filter((id) => id !== viewID && isSourceView(viewStore.getView(id)))
        .forEach((vid) => {
          windowingStore.updateConfig(vid, dataID, config);
        });
    } finally {
      isUpdating = false;
    }
  });

  viewStore.LayoutViewReplacedEvent.on((beforeViewID, afterViewID) => {
    const beforeView = viewStore.getView(beforeViewID);
    const afterView = viewStore.getView(afterViewID);

    if (!beforeView || !isSourceView(afterView)) return;

    const dataID = afterView.dataID;
    if (!dataID) return;

    const sourceView =
      isSourceView(beforeView) && beforeView.dataID === dataID
        ? beforeView
        : findBoundSourcePeer(afterViewID, dataID);
    if (!sourceView) return;

    const config = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(afterViewID, dataID, config);
  });

  viewStore.ViewDataChangeEvent.on((viewID, dataID) => {
    if (!dataID || !isSourceView(viewStore.getView(viewID))) return;

    const config = windowingStore.getConfig(viewID, dataID);
    if ('width' in config && 'level' in config) return;

    const sourceView = findBoundSourcePeer(viewID, dataID);
    if (!sourceView) return;

    const sourceConfig = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(viewID, dataID, sourceConfig);
  });
}
