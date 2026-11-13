import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { useViewSliceStore } from '@/src/store/view-configs/slicing';
import type { ViewInfo, ViewInfo2D } from '@/src/types/views';

// A DICOM volume's third index axis is its acquisition axis.
const SLICE_AXIS = 2;

/**
 * The slice of `dataID` a 2D view looking along its acquisition axis shows,
 * preferring the active view; undefined when no view shows one yet.
 */
export function viewedSlice(dataID: string) {
  const views = useViewStore();
  const metadata = useImageCacheStore().getImageMetadata(dataID);
  if (!metadata) return undefined;
  const alongSlices = views.visibleViews.filter(
    (view: ViewInfo): view is ViewInfo2D =>
      view.type === '2D' &&
      view.dataID === dataID &&
      metadata.lpsOrientation[view.options.orientation] === SLICE_AXIS
  );
  const view =
    alongSlices.find(({ id }) => id === views.activeView) ?? alongSlices[0];
  return view
    ? useViewSliceStore().configs[view.id]?.[dataID]?.slice
    : undefined;
}
