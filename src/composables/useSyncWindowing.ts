import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { ViewInfo } from '@/src/types/views';

export function useSyncWindowing() {
  const windowingStore = useWindowingStore();
  const viewStore = useViewStore();
  let isUpdating = false;

  windowingStore.WindowingUpdateEvent.on((viewID, dataID) => {
    if (isUpdating) return;
    isUpdating = true;
    try {
      const config = windowingStore.getConfig(viewID, dataID);
      viewStore.viewIDs
        .filter((id) => id !== viewID)
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

    if (!beforeView || !afterView) return;

    const dataID = afterView.dataID;
    // don't sync to a blank view
    if (!dataID) return;

    // find another view with the same data ID
    let sourceView: Maybe<ViewInfo> = beforeView;
    if (beforeView.dataID !== dataID) {
      sourceView = viewStore
        .getAllViews()
        .find((view) => view.dataID === dataID);
    }

    // no source view, so no sync
    if (!sourceView) return;

    const config = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(afterViewID, dataID, config);
  });

  viewStore.ViewDataChangeEvent.on((viewID, dataID) => {
    // no sync if no data
    if (!dataID) return;

    // if the config already exists, safe to assume that windowing
    // is correct
    const config = windowingStore.getConfig(viewID, dataID);
    if ('width' in config && 'level' in config) return;

    // find another view with the dataset and sync the config
    const sourceView = viewStore
      .getAllViews()
      .find((view) => view.dataID === dataID);
    if (!sourceView) return;

    const sourceConfig = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(viewID, dataID, sourceConfig);
  });
}
