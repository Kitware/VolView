import {
  sharesSourceWindowing,
  useWindowingStore,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';

export function useSyncWindowing() {
  const windowingStore = useWindowingStore();
  const viewStore = useViewStore();
  let isUpdating = false;
  const getBoundSourcePeers = (viewID: string, dataID: string) =>
    viewStore
      .getViewsForData(dataID)
      .filter((view) => view.id !== viewID && sharesSourceWindowing(view));

  windowingStore.WindowingUpdateEvent.on((viewID, dataID) => {
    if (isUpdating || !sharesSourceWindowing(viewStore.getView(viewID))) return;
    isUpdating = true;
    try {
      const config = windowingStore.getConfig(viewID, dataID);
      viewStore.viewIDs
        .filter(
          (id) => id !== viewID && sharesSourceWindowing(viewStore.getView(id))
        )
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

    if (!beforeView || !sharesSourceWindowing(afterView)) return;

    const dataID = afterView.dataID;
    if (!dataID) return;

    const sourceView =
      sharesSourceWindowing(beforeView) && beforeView.dataID === dataID
        ? beforeView
        : getBoundSourcePeers(afterViewID, dataID)[0];
    if (!sourceView) return;

    const config = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(afterViewID, dataID, config);
  });

  viewStore.ViewDataChangeEvent.on((viewID, dataID) => {
    if (!dataID || !sharesSourceWindowing(viewStore.getView(viewID))) return;

    if (windowingStore.getInternalConfig(viewID, dataID)) return;

    const sourceView = getBoundSourcePeers(viewID, dataID).find((view) =>
      windowingStore.getInternalConfig(view.id, dataID)
    );
    if (!sourceView) return;

    const sourceConfig = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(viewID, dataID, sourceConfig);
  });
}
