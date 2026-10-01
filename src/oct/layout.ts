import type { Maybe } from '@/src/types';
import type { ViewInfo, ViewInfoInit } from '@/src/types/views';
import type { LayoutItem } from '@/src/types/layout';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import { LPSAxes } from '@/src/utils/lps';
import { getOCTAvailability } from './availability';

export const OCT_LAYOUT_NAME = 'Retinal OCT';

function sourceOrientation(imageID: Maybe<string>) {
  const metadata = useImageCacheStore().getImageMetadata(imageID);
  return LPSAxes.find((axis) => metadata?.lpsOrientation[axis] === 2);
}

export function getOCTLayoutReason(imageID: Maybe<string>) {
  const availability = getOCTAvailability(imageID);
  if (availability.reason) return availability.reason;
  const views = useViewStore();
  if (views.disabledViewTypes.includes('2D'))
    return 'The current configuration disables 2D slice views.';
  if (views.disabledViewTypes.includes('EnFace'))
    return 'The current configuration disables En face views.';
  if (!sourceOrientation(imageID))
    return 'The source OCT B-scan orientation is unavailable.';
  return null;
}

function paneCount(item: LayoutItem): number {
  return item.type === 'slot'
    ? 1
    : item.items.reduce((count, child) => count + paneCount(child), 0);
}

function matchingOCTViews(panes: ViewInfo[]) {
  const [source, enface] = panes;
  if (panes.length !== 2 || !source || !enface || !source.dataID) return false;
  return (
    source.type === '2D' &&
    enface.type === 'EnFace' &&
    source.dataID === enface.dataID &&
    source.options.orientation === sourceOrientation(source.dataID)
  );
}

export function isOCTLayoutActive() {
  const views = useViewStore();
  const layout = views.visibleLayout;
  return (
    views.currentLayoutName === null &&
    layout.direction === 'column' &&
    layout.items.length === 2 &&
    layout.items.every((item) => paneCount(item) === 1) &&
    matchingOCTViews(views.layoutViews)
  );
}
/** Bind both comparison panes to the captured active image, leaving other views alone. */
export function applyOCTLayout(imageID: Maybe<string>) {
  if (!imageID || getOCTLayoutReason(imageID)) return false;
  const orientation = sourceOrientation(imageID);
  if (!orientation) return false;
  const views = useViewStore();
  const comparisonViews = [
    {
      type: '2D',
      name: orientation,
      dataID: imageID,
      options: { orientation },
    },
    { type: 'EnFace', name: 'En face', dataID: imageID, options: {} },
  ] satisfies ViewInfoInit[];
  views.setLayoutFromGrid([1, 2]);
  comparisonViews.forEach((next, index) => {
    const existing = views.layoutViews[index];
    const matches =
      existing.type === next.type &&
      JSON.stringify(existing.options) === JSON.stringify(next.options);
    if (matches) views.setDataForView(existing.id, imageID);
    else views.replaceView(existing.id, next);
  });
  return true;
}
