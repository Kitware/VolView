import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import { Maybe } from '@/src/types';
import { ViewInfo } from '@/src/types/views';

export function useSyncWindowing() {
  const windowingStore = useWindowingStore();
  const viewStore = useViewStore();
  let isUpdating = false;
  const isProjection = (id: string) => viewStore.getView(id)?.type === 'EnFace';

  windowingStore.WindowingUpdateEvent.on((viewID, dataID) => {
    // Each projection method and slab has its own intensity distribution.
    if (isUpdating || isProjection(viewID)) return;
    isUpdating = true;
    try {
      const config = windowingStore.getConfig(viewID, dataID);
      viewStore.viewIDs
        .filter((id) => id !== viewID && !isProjection(id))
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

    if (!beforeView || !afterView || afterView.type === 'EnFace') return;

    const dataID = afterView.dataID;
    if (!dataID) return;

    let sourceView: Maybe<ViewInfo> = beforeView;
    if (beforeView.type === 'EnFace' || beforeView.dataID !== dataID) {
      sourceView = viewStore
        .getAllViews()
        .find(
          (view) =>
            view.id !== afterViewID &&
            view.dataID === dataID &&
            view.type !== 'EnFace'
        );
    }
    if (!sourceView) return;

    const config = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(afterViewID, dataID, config);
  });

  viewStore.ViewDataChangeEvent.on((viewID, dataID) => {
    if (!dataID || isProjection(viewID)) return;

    const config = windowingStore.getConfig(viewID, dataID);
    if ('width' in config && 'level' in config) return;

    const sourceView = viewStore
      .getAllViews()
      .find(
        (view) =>
          view.id !== viewID && view.dataID === dataID && view.type !== 'EnFace'
      );
    if (!sourceView) return;

    const sourceConfig = windowingStore.getConfig(sourceView.id, dataID);
    windowingStore.updateConfig(viewID, dataID, sourceConfig);
  });
}
