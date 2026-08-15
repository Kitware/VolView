import type { LPSAxis } from '@/src/types/lps';
import type {
  ViewInfo,
  ViewInfo2D,
  ViewInfo3D,
  ViewInfoOblique,
} from '@/src/types/views';
import type { Maybe } from '@/src/types';
import { isCineImage } from '@/src/core/cine/isCineImage';
import { useViewStore } from '@/src/store/views';

export type EffectiveView =
  | { kind: 'empty'; viewInfo: ViewInfo; renderDataID: null }
  | {
      kind: 'volume2D';
      viewInfo: ViewInfo2D;
      renderDataID: string;
      axis: LPSAxis;
    }
  | { kind: 'volume3D'; viewInfo: ViewInfo3D; renderDataID: string }
  | { kind: 'oblique'; viewInfo: ViewInfoOblique; renderDataID: string }
  | { kind: 'cine'; viewInfo: ViewInfo; renderDataID: string };

export function computeEffectiveView(
  viewInfo: ViewInfo,
  dataID: Maybe<string>
): EffectiveView {
  if (!dataID) return { kind: 'empty', viewInfo, renderDataID: null };
  if (isCineImage(dataID))
    return { kind: 'cine', viewInfo, renderDataID: dataID };
  if (viewInfo.type === '2D') {
    return {
      kind: 'volume2D',
      viewInfo,
      renderDataID: dataID,
      axis: viewInfo.options.orientation,
    };
  }
  if (viewInfo.type === '3D')
    return { kind: 'volume3D', viewInfo, renderDataID: dataID };
  return { kind: 'oblique', viewInfo, renderDataID: dataID };
}

/**
 * The slicing (volume2D) views among `views` that render `imageID`, with
 * their slicing axes.
 */
export function volume2DViewsOfImage(imageID: string, views: ViewInfo[]) {
  return views.flatMap((view) => {
    const effective = computeEffectiveView(view, view.dataID);
    if (effective.kind !== 'volume2D') return [];
    if (effective.renderDataID !== imageID) return [];
    return [{ viewId: view.id, axis: effective.axis }];
  });
}

export function getEffectiveView(viewID: Maybe<string>): EffectiveView | null {
  if (!viewID) return null;
  const view = useViewStore().getView(viewID);
  if (!view) return null;
  return computeEffectiveView(view, view.dataID);
}
