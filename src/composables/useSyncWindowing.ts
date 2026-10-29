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
  const getBoundSourcePeers = (viewID: string, dataID: string) =>
    viewStore
      .getAllViews()
      .filter(
        (view) =>
          view.id !== viewID && isSourceView(view) && view.dataID === dataID
      );

  windowingStore.WindowingUpdateEvent.on((viewID, dataID) => {
    const sourceView = viewStore.getView(viewID);
    // Each projection method and slab has its own intensity distribution.
    if (isUpdating || !isSourceView(sourceView)) return;
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
        : getBoundSourcePeers(afterViewID, dataID)[0];
    if (!sourceView) return;

    const config = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(afterViewID, dataID, config);
  });

  viewStore.ViewDataChangeEvent.on((viewID, dataID) => {
    if (!dataID || !isSourceView(viewStore.getView(viewID))) return;

    if (windowingStore.getInternalConfig(viewID, dataID)) return;

    const sourceView = getBoundSourcePeers(viewID, dataID).find((view) =>
      windowingStore.getInternalConfig(view.id, dataID)
    );
    if (!sourceView) return;

    const sourceConfig = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(viewID, dataID, sourceConfig);
  });
}
