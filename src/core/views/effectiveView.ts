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

export function getEffectiveView(viewID: Maybe<string>): EffectiveView | null {
  if (!viewID) return null;
  const view = useViewStore().getView(viewID);
  if (!view) return null;
  return computeEffectiveView(view, view.dataID);
}
